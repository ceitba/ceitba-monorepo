// service/sync/FirestoreImportService + FirestoreImportReport: one-time import
// of the legacy Firestore export (POST /v1/sync/import/firestore). Every
// document runs in its own transaction; a dry run rolls each one back. See
// the Java class for the matching rules (users by firebase_uid then email,
// only NULL columns filled, benefits by Spanish title, proposals through
// ProposalFirestoreImporter). Reports carry document ids, never emails.

import type { Deps } from '../../deps';
import { isDataIntegrityViolation, withTx, type Db } from '../../db/client';
import { ValidationError } from '../../http/errors';
import { claimInvites, followIfMissing } from '../../http/auth/repo';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import { ContentHmac } from '../crypto/logic/contentHmac';
import { ProposalAliasGenerator } from '../proposal/logic/proposalAliasGenerator';
import * as socialHandles from '../user/logic/socialHandles';
import { FirestoreImportError, ProposalFirestoreImporter, type Outcome } from './proposalImporter';
import * as repo from './repo';
import { dbImportRows, dbImportUsers } from './repo';

export const USUARIOS = 'usuarios';
export const BENEFITS = 'benefits';
export const PROPUESTAS = 'propuestas';
const FALLBACK_CATEGORY = 'convenios';
const CEITBA_ORG = 'ceitba';
const HTTP_URL = /^https?:\/\/[^ \t\n\x0B\f\r]+$/;
const MAX_URL = 2048;
const MAX_VARCHAR = 255;
const MAX_PHONE = 64;

export interface FirestoreUserDoc {
  id: string | null; email: string | null; name: string | null; degree: string | null; plan: string | null;
  moderator: boolean | null; socialMedia: { linkedin: string | null; instagram: string | null; discord: string | null } | null;
}
export interface FirestoreBenefitDoc {
  id: string | null; title: string | null; category: string | null; imageUrl: string | null; description: string[] | null;
  location: string | null; locationUrl: string | null; inscriptionUrl: string | null; phone: string | null; website: string | null; email: string | null;
}
export interface FirestoreExport {
  usuarios: (FirestoreUserDoc | null)[] | null;
  propuestas: (Record<string, unknown> | null)[] | null;
  benefits: (FirestoreBenefitDoc | null)[] | null;
}

export class Counters {
  created = 0;
  updated = 0;
  skipped = 0;
  errors = 0;
  count(o: Outcome) {
    if (o === 'CREATED') this.created++;
    else if (o === 'UPDATED') this.updated++;
    else this.skipped++;
  }
}
export interface Issue { collection: string; id: string | null; message: string }

export class FirestoreImportReport {
  readonly usuarios = new Counters();
  readonly benefits = new Counters();
  readonly propuestas = new Counters();
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];
  constructor(readonly dryRun: boolean) {}
  get created() { return this.usuarios.created + this.benefits.created + this.propuestas.created; }
  get updated() { return this.usuarios.updated + this.benefits.updated + this.propuestas.updated; }
  get skipped() { return this.usuarios.skipped + this.benefits.skipped + this.propuestas.skipped; }
  error(collection: string, id: string | null, message: string) { this.errors.push({ collection, id, message }); }
  warning(collection: string, id: string | null, message: string) { this.warnings.push({ collection, id, message }); }
}

/** FirestoreImportResponse.from(report): record component order. */
export function importResponse(r: FirestoreImportReport) {
  const c = (x: Counters) => ({ created: x.created, updated: x.updated, skipped: x.skipped, errors: x.errors });
  return {
    dryRun: r.dryRun, created: r.created, updated: r.updated, skipped: r.skipped,
    usuarios: c(r.usuarios), benefits: c(r.benefits), propuestas: c(r.propuestas),
    errors: r.errors.map((i) => ({ collection: i.collection, id: i.id, message: i.message })),
    warnings: r.warnings.map((i) => ({ collection: i.collection, id: i.id, message: i.message })),
  };
}

function trimToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = javaTrim(s);
  return t.length === 0 ? null : t;
}

/** Careers and plans as of the start of the run (the import never writes them). */
class Catalogue {
  constructor(readonly careerIds: Set<string>, readonly careerIdsByName: Map<string, string>, readonly planIdsByCareer: Map<string, Set<string>>) {}
  resolve(degree: string | null, plan: string | null): { careerId: string | null; planId: string | null } {
    const d = trimToNull(degree);
    if (d === null) return { careerId: null, planId: null };
    const careerId = this.careerIds.has(d) ? d : this.careerIdsByName.get(d.toLowerCase()) ?? null;
    if (careerId === null) return { careerId: null, planId: null };
    const p = trimToNull(plan);
    if (p === null) return { careerId, planId: null };
    if (this.planIdsByCareer.get(careerId)?.has(p)) return { careerId, planId: p };
    // A plan outside the career's catalogue: stale, let the user pick both.
    return { careerId: null, planId: null };
  }
}

/** Rolls a dry-run document transaction back while keeping its outcome. */
class DryRunRollback extends Error {
  constructor(readonly outcome: Outcome) { super('dry run'); }
}

type Row = Record<string, unknown>;

/** The proposal importer seam (FirestoreProposalImporter). */
export interface ProposalImporterPort {
  isAvailable(): boolean;
  importProposal(documentId: string, doc: Record<string, unknown>, warnings: string[]): Promise<Outcome>;
}

export class FirestoreImportService {
  private readonly log;
  /** Built per document transaction (the rows run in that transaction). */
  private readonly proposals: (tx: Db) => ProposalImporterPort;

  constructor(private readonly deps: Deps, proposals?: (tx: Db) => ProposalImporterPort) {
    this.log = deps.log.child({ component: 'FirestoreImportService' });
    let hmac: ContentHmac | null = null;
    const generator = new ProposalAliasGenerator();
    this.proposals = proposals ?? ((tx) => {
      hmac ??= new ContentHmac(deps.config.auth.jwt.secret, deps.config.auth.contentHmacSecret);
      return new ProposalFirestoreImporter(dbImportRows(tx), dbImportUsers(tx), generator, () => deps.clock.now(), hmac);
    });
  }

  async importExport(exp: FirestoreExport, dryRun: boolean): Promise<FirestoreImportReport> {
    const report = new FirestoreImportReport(dryRun);
    const catalogue = await withTx(this.deps.db, (tx) => this.loadCatalogue(tx), { readOnly: true });

    for (const doc of exp.usuarios ?? []) {
      if (doc === null) continue;
      await this.runDocument(report, USUARIOS, doc.id, report.usuarios, dryRun, (tx, w) => this.importUser(tx, doc, catalogue, w));
    }
    for (const doc of exp.benefits ?? []) {
      if (doc === null) continue;
      await this.runDocument(report, BENEFITS, doc.id, report.benefits, dryRun, (tx, w) => this.importBenefit(tx, doc, w));
    }
    await this.importProposals(exp.propuestas ?? [], report, dryRun);

    this.log.info({ dryRun, created: report.created, updated: report.updated, skipped: report.skipped,
      errors: report.errors.length, warnings: report.warnings.length }, 'Firestore import');
    return report;
  }

  private async importProposals(docs: (Record<string, unknown> | null)[], report: FirestoreImportReport, dryRun: boolean) {
    if (docs.length === 0) return;
    if (!this.proposals(this.deps.db).isAvailable()) {
      report.propuestas.skipped += docs.length;
      report.warning(PROPUESTAS, null, `${docs.length} documents skipped: the proposal schema is not available yet`);
      return;
    }
    for (const doc of docs) {
      if (doc === null) continue;
      const id = typeof doc.id === 'string' ? doc.id : null;
      await this.runDocument(report, PROPUESTAS, id, report.propuestas, dryRun, (tx, w) => {
        if (id === null || javaIsBlank(id)) throw new FirestoreImportError('missing document id');
        return this.proposals(tx).importProposal(id, doc, w);
      });
    }
  }

  private async runDocument(report: FirestoreImportReport, collection: string, id: string | null, counters: Counters, dryRun: boolean,
    work: (tx: Db, warnings: string[]) => Promise<Outcome>) {
    const warnings: string[] = [];
    try {
      let outcome: Outcome;
      try {
        outcome = await withTx(this.deps.db, async (tx) => {
          const r = await work(tx, warnings);
          if (dryRun) throw new DryRunRollback(r);
          return r;
        });
      } catch (e) {
        if (e instanceof DryRunRollback) outcome = e.outcome;
        else throw e;
      }
      counters.count(outcome);
      for (const w of warnings) report.warning(collection, id, w);
    } catch (e) {
      counters.errors++;
      if (e instanceof FirestoreImportError) {
        report.error(collection, id, e.message);
      } else if (isDataIntegrityViolation(e)) {
        // The driver message quotes the conflicting values (emails): neither reported nor logged.
        report.error(collection, id, 'conflicts with an existing row');
        this.log.warn(`Firestore import ${collection}/${id}: constraint violation`);
      } else {
        const name = javaExceptionName(e);
        report.error(collection, id, `unexpected error (${name})`);
        this.log.warn(`Firestore import ${collection}/${id} failed: ${name}`);
      }
    }
  }

  // ---------------------------------------------------------------- users

  private async importUser(tx: Db, doc: FirestoreUserDoc, catalogue: Catalogue, warnings: string[]): Promise<Outcome> {
    const uid = trimToNull(doc.id);
    if (uid === null) throw new FirestoreImportError('missing document id');
    if (uid.length > 128) throw new FirestoreImportError('document id longer than 128 characters');
    if (await dbImportUsers(tx).isDeletedFirebaseAccount(uid)) {
      warnings.push('account was deleted in the new app; not re-imported');
      return 'SKIPPED';
    }
    let email = trimToNull(doc.email);
    if (email === null || email.indexOf('@') < 1 || email.length > MAX_VARCHAR) throw new FirestoreImportError('missing or invalid email');
    email = email.toLowerCase();

    const byUid = await repo.userByFirebaseUid(tx, uid);
    const byEmail = await repo.oldestUserByEmailIgnoreCase(tx, email);
    if (byUid && byEmail && byUid.id !== byEmail.id) throw new FirestoreImportError('firebase uid and email belong to different users');

    let user: Row;
    let created = false;
    let changed = false;
    if (byUid) user = byUid;
    else if (byEmail) {
      user = byEmail;
      if (user.firebase_uid !== null) throw new FirestoreImportError('user is already linked to another firebase uid');
    } else {
      user = { id: crypto.randomUUID(), email, name: null, firebase_uid: null, career_id: null, plan: null, linkedin: null, instagram: null, discord: null };
      created = true;
    }

    if (user.firebase_uid === null) { user.firebase_uid = uid; changed = true; }
    const name = trimToNull(doc.name);
    if (user.name === null && name !== null) { user.name = name; changed = true; }

    const academic = catalogue.resolve(doc.degree, doc.plan);
    if (user.career_id === null && academic.careerId !== null) { user.career_id = academic.careerId; changed = true; }
    if (user.plan === null && academic.planId !== null && user.career_id !== null && academic.careerId === user.career_id) {
      user.plan = academic.planId;
      changed = true;
    }

    const social = doc.socialMedia;
    if (social) {
      changed = fillHandle(user, 'linkedin', social.linkedin, socialHandles.linkedin, warnings) || changed;
      changed = fillHandle(user, 'instagram', social.instagram, socialHandles.instagram, warnings) || changed;
      changed = fillHandle(user, 'discord', social.discord, socialHandles.discord, warnings) || changed;
    }

    const now = toPgTimestamp(systemNowMicros());
    if (created) {
      await repo.insertImportedUser(tx, user, now);
      await followIfMissing(tx, user.id as string, CEITBA_ORG);
      // Pending org invites of this email, as on a first login.
      await claimInvites(tx, user.id as string, email);
    } else if (changed) {
      await repo.updateImportedUser(tx, user, now);
    }

    if (doc.moderator === true) {
      const grants = await repo.moderatorGrantsOf(tx, user.id as string);
      if (grants.length === 0) {
        await repo.insertModeratorGrant(tx, user.id as string, toPgTimestamp(this.deps.clock.now()));
        changed = true;
      } else if (grants[0]!.revoked_at !== null) {
        warnings.push('moderator grant was revoked by staff; not re-granted');
      }
    }

    if (created) return 'CREATED';
    return changed ? 'UPDATED' : 'SKIPPED';
  }

  // ------------------------------------------------------------- benefits

  private async importBenefit(tx: Db, doc: FirestoreBenefitDoc, warnings: string[]): Promise<Outcome> {
    const title = trimToNull(doc.title);
    if (title === null) throw new FirestoreImportError('missing title');
    if (title.length > MAX_VARCHAR) throw new FirestoreImportError('title longer than 255 characters');

    const matches = await repo.benefitCardsTitled(tx, title);
    if (matches.length > 1) throw new FirestoreImportError('several benefit cards share this title');

    const slug = await this.categorySlug(tx, doc.category, warnings);
    const created = matches.length === 0;
    const card: Row = created
      ? { id: crypto.randomUUID(), category_slug: slug, title_es: title, bullets_es: [], image_url: null, cta_url: null, location: null, location_url: null, phone: null, website: null, email: null }
      : { ...matches[0]! };

    let changed = false;
    const apply = (col: string, next: unknown) => {
      const cur = card[col];
      const same = Array.isArray(cur) && Array.isArray(next)
        ? cur.length === next.length && cur.every((v, i) => v === next[i])
        : cur === next;
      if (same) return;
      card[col] = next;
      changed = true;
    };
    apply('category_slug', slug);
    apply('title_es', title);
    apply('bullets_es', bullets(doc.description));
    apply('image_url', url(doc.imageUrl, 'imageUrl', warnings));
    apply('cta_url', url(doc.inscriptionUrl, 'inscriptionUrl', warnings));
    apply('location', trimToNull(doc.location));
    apply('location_url', url(doc.locationUrl, 'locationUrl', warnings));
    apply('phone', bounded(doc.phone, MAX_PHONE, 'phone', warnings));
    apply('website', url(doc.website, 'website', warnings));
    apply('email', bounded(doc.email, MAX_VARCHAR, 'email', warnings));

    const now = toPgTimestamp(systemNowMicros());
    const bulletsArr = card.bullets_es as string[];
    if (created) {
      await repo.insertBenefitCard(tx, card, title, bulletsArr, now);
    } else if (changed) {
      await repo.updateBenefitCard(tx, card, bulletsArr, now);
    }
    if (created) return 'CREATED';
    return changed ? 'UPDATED' : 'SKIPPED';
  }

  private async categorySlug(tx: Db, category: string | null, warnings: string[]): Promise<string> {
    const exists = (s: string) => repo.benefitCategoryExists(tx, s);
    let slug = trimToNull(category);
    if (slug !== null) {
      slug = slug.toLowerCase();
      if (await exists(slug)) return slug;
    }
    if (!(await exists(FALLBACK_CATEGORY))) throw new FirestoreImportError(`fallback category '${FALLBACK_CATEGORY}' does not exist`);
    if (slug !== null) warnings.push(`unknown category '${slug}' filed under ${FALLBACK_CATEGORY}`);
    return FALLBACK_CATEGORY;
  }

  private async loadCatalogue(tx: Db): Promise<Catalogue> {
    const ids = new Set<string>();
    const byName = new Map<string, string>();
    for (const c of await repo.careerNames(tx)) {
      ids.add(c.id as string);
      if (c.name !== null) {
        const key = javaTrim(c.name as string).toLowerCase();
        if (!byName.has(key)) byName.set(key, c.id as string);
      }
    }
    const plans = new Map<string, Set<string>>();
    for (const p of await repo.planCareers(tx)) {
      const s = plans.get(p.career_id as string) ?? new Set<string>();
      s.add(p.id as string);
      plans.set(p.career_id as string, s);
    }
    return new Catalogue(ids, byName, plans);
  }
}

function fillHandle(user: Row, field: 'linkedin' | 'instagram' | 'discord', raw: string | null, normalize: (s: string) => string, warnings: string[]): boolean {
  if (user[field] !== null || raw === null || javaIsBlank(raw)) return false;
  try {
    user[field] = normalize(raw);
    return true;
  } catch (e) {
    if (e instanceof ValidationError) {
      warnings.push(`invalid ${field} handle dropped`);
      return false;
    }
    throw e;
  }
}

function bullets(description: string[] | null): string[] {
  if (description === null) return [];
  const out: string[] = [];
  for (const line of description) {
    const t = trimToNull(line);
    if (t !== null) out.push(t);
  }
  return out;
}

function url(raw: string | null, field: string, warnings: string[]): string | null {
  const v = trimToNull(raw);
  if (v === null) return null;
  if (v.length > MAX_URL || !HTTP_URL.test(v)) {
    warnings.push(`${field} is not an http(s) URL; dropped`);
    return null;
  }
  return v;
}

function bounded(raw: string | null, max: number, field: string, warnings: string[]): string | null {
  const v = trimToNull(raw);
  if (v !== null && v.length > max) {
    warnings.push(`${field} longer than ${max} characters; dropped`);
    return null;
  }
  return v;
}

/** e.getClass().getSimpleName() for the errors a JS port can raise. */
function javaExceptionName(e: unknown): string {
  const named = (e as { javaName?: unknown } | null)?.javaName;
  if (typeof named === 'string') return named;
  if (e instanceof TypeError) return 'NullPointerException';
  if (e instanceof RangeError) return 'IllegalArgumentException';
  return 'RuntimeException';
}
