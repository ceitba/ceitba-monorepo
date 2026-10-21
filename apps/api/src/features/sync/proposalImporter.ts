// service/sync/ProposalFirestoreImporter + repository/proposal/ProposalImportRepository:
// maps one legacy Firestore 'Propuestas' document onto the proposal tables.
// See the Java class for the field mapping; it is idempotent on the document
// id, and re-runs only add missing votes/comments/aliases/attachments.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { javaTrim, javaUtf8 } from '../../lib/javaCompat';
import { formatOffsetDateTime, parseIsoInstant, toPgTimestamp, type Micros } from '../../lib/time';
import { FIRESTORE_COMMENT_IDS, type ContentHmac } from '../crypto/logic/contentHmac';
import type { ProposalAliasGenerator } from '../proposal/logic/proposalAliasGenerator';

export type Outcome = 'CREATED' | 'UPDATED' | 'SKIPPED';

/** FirestoreImportException: a document that cannot be imported (message goes to the report, never PII). */
export class FirestoreImportError extends Error {}

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 5000;
export const MAX_REASON = 1024;
export const MAX_COMMENT = 1000;
export const MAX_ALIAS = 40;

const TOPICS = ['VIDA_UNIVERSITARIA', 'CEITBA', 'EVENTOS', 'CURSOS', 'OTROS'] as const;
const LIFECYCLES = ['ABIERTO', 'ACEPTADO', 'CERRADO'] as const;
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf',
};
export const LEGACY_ATTACHMENT_KEY = /^proposals\/legacy\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|heic|pdf)$/;

/** The writes behind the import (ProposalImportRepository): every insert is ON CONFLICT DO NOTHING. */
export interface ProposalImportRows {
  insertProposal(id: string, authorId: string | null, title: string, description: string, topic: string, status: string,
    lifecycle: string, rejectionReason: string | null, moderatedBy: string | null, createdAt: Micros): Promise<boolean>;
  proposalExists(id: string): Promise<boolean>;
  lockProposal(id: string): Promise<void>;
  aliases(proposalId: string): Promise<Map<string, string>>;
  insertAlias(proposalId: string, userId: string, alias: string): Promise<boolean>;
  insertVote(proposalId: string, userId: string, value: string, at: Micros): Promise<boolean>;
  insertComment(id: string, proposalId: string, authorId: string | null, parentId: string | null, body: string, at: Micros): Promise<boolean>;
  insertDeletedComment(id: string, proposalId: string, parentId: string | null, at: Micros): Promise<boolean>;
  insertAttachment(proposalId: string, position: number, objectKey: string, contentType: string): Promise<boolean>;
  recomputeCounters(proposalId: string): Promise<void>;
}

/** The user lookups the importer needs (UserRepository). */
export interface ImportUsers {
  /** firebase uid -> user id. */
  findByFirebaseUidIn(uids: string[]): Promise<Map<string, string>>;
  isDeletedFirebaseAccount(uid: string): Promise<boolean>;
}

const count = (r: unknown) => (r as { count?: number }).count ?? 0;

export function dbImportRows(db: Db): ProposalImportRows {
  return {
    async insertProposal(id, authorId, title, description, topic, status, lifecycle, reason, mod, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`
        INSERT INTO public.proposal (id, author_id, title, description, topic, status, lifecycle, rejection_reason, moderated_by, created_at, updated_at)
        VALUES (${id}, ${authorId}, ${title}, ${description}, ${topic}, ${status}, ${lifecycle}, ${reason}, ${mod}, ${ts}, ${ts})
        ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async proposalExists(id) {
      const rows = (await db.execute(sql`SELECT EXISTS (SELECT 1 FROM public.proposal WHERE id = ${id}) AS e`)) as unknown as { e: boolean }[];
      return rows[0]!.e === true;
    },
    async lockProposal(id) {
      await db.execute(sql`SELECT id FROM public.proposal WHERE id = ${id} FOR UPDATE`);
    },
    async aliases(proposalId) {
      const rows = (await db.execute(sql`SELECT user_id, alias FROM public.proposal_alias WHERE proposal_id = ${proposalId}`)) as unknown as { user_id: string; alias: string }[];
      return new Map(rows.map((r) => [r.user_id, r.alias]));
    },
    async insertAlias(proposalId, userId, alias) {
      return count(await db.execute(sql`INSERT INTO public.proposal_alias (proposal_id, user_id, alias) VALUES (${proposalId}, ${userId}, ${alias}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async insertVote(proposalId, userId, value, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`INSERT INTO public.proposal_vote (proposal_id, user_id, value, created_at, updated_at)
        VALUES (${proposalId}, ${userId}, ${value}, ${ts}, ${ts}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async insertComment(id, proposalId, authorId, parentId, body, at) {
      return count(await db.execute(sql`INSERT INTO public.proposal_comment (id, proposal_id, author_id, parent_id, body, created_at)
        VALUES (${id}, ${proposalId}, ${authorId}, ${parentId}, ${body}, ${toPgTimestamp(at)}) ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async insertDeletedComment(id, proposalId, parentId, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`INSERT INTO public.proposal_comment (id, proposal_id, parent_id, body, created_at, deleted_at)
        VALUES (${id}, ${proposalId}, ${parentId}, NULL, ${ts}, ${ts}) ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async insertAttachment(proposalId, position, key, type) {
      return count(await db.execute(sql`INSERT INTO public.proposal_attachment (proposal_id, position, object_key, content_type)
        VALUES (${proposalId}, ${position}, ${key}, ${type}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async recomputeCounters(id) {
      await db.execute(sql`
        UPDATE public.proposal p SET
            up_count      = (SELECT count(*) FROM public.proposal_vote v WHERE v.proposal_id = p.id AND v.value = 'UP'),
            down_count    = (SELECT count(*) FROM public.proposal_vote v WHERE v.proposal_id = p.id AND v.value = 'DOWN'),
            comment_count = (SELECT count(*) FROM public.proposal_comment c WHERE c.proposal_id = p.id AND c.deleted_at IS NULL)
        WHERE p.id = ${id}`);
    },
  };
}

export function dbImportUsers(db: Db): ImportUsers {
  return {
    async findByFirebaseUidIn(uids) {
      if (uids.length === 0) return new Map();
      const rows = (await db.execute(sql`SELECT id, firebase_uid FROM public."user" WHERE firebase_uid IN (${sql.join(uids.map((u) => sql`${u}`), sql`, `)})`)) as unknown as { id: string; firebase_uid: string }[];
      return new Map(rows.map((r) => [r.firebase_uid, r.id]));
    },
    async isDeletedFirebaseAccount(uid) {
      const rows = (await db.execute(sql`SELECT EXISTS (SELECT 1 FROM public.deleted_firebase_accounts
        WHERE firebase_uid_sha256 = encode(sha256(convert_to(${uid}, 'UTF8')), 'hex')) AS e`)) as unknown as { e: boolean }[];
      return rows[0]!.e === true;
    },
  };
}

// ------------------------------------------------------------------ helpers

/** str(o): a trimmed non-empty String, else null (non-strings are null). */
export function str(o: unknown): string | null {
  if (typeof o !== 'string') return null;
  const t = javaTrim(o);
  return t.length === 0 ? null : t;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Object.toString() of a Jackson-bound JSON value (LinkedHashMap / ArrayList / Integer / Double ...). */
export function javaToString(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 63) return String(v);
    const s = String(v);
    if (/e/i.test(s)) {
      const [m, e] = s.split(/e/i) as [string, string];
      return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
    }
    return s.includes('.') ? s : `${s}.0`;
  }
  if (Array.isArray(v)) return `[${v.map(javaToString).join(', ')}]`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}=${javaToString(x)}`).join(', ')}}`;
}

/** UUID.nameUUIDFromBytes: MD5, version 3. */
export function nameUuid(name: string): string {
  const d = createHash('md5').update(javaUtf8(name)).digest();
  d[6] = (d[6]! & 0x0f) | 0x30;
  d[8] = (d[8]! & 0x3f) | 0x80;
  const h = d.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const proposalId = (documentId: string) => nameUuid(`firestore:propuestas:${documentId}`);

export function topic(raw: unknown, warnings: string[]): string {
  const t = str(raw);
  if (t !== null) {
    const normalized = t.normalize('NFD').replace(/\p{M}+/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if ((TOPICS as readonly string[]).includes(normalized)) return normalized;
  }
  warnings.push(`${t === null ? 'missing' : 'unknown'} topic; filed under OTROS`);
  return 'OTROS';
}

/** authorized: 0 PENDING, 1 APPROVED, 2 REJECTED; an integral number or a numeric string. */
export function moderation(raw: unknown): string {
  let value: number | null = null;
  if (typeof raw === 'number') {
    const asInt = Math.trunc(raw) | 0;
    if (raw === asInt) value = asInt;
  } else if (typeof raw === 'string') {
    const t = javaTrim(raw);
    if (/^[+-]?\d+$/.test(t) && Math.abs(Number(t)) <= 2147483647) value = Number(t);
  }
  if (value === 0) return 'PENDING';
  if (value === 1) return 'APPROVED';
  if (value === 2) return 'REJECTED';
  throw new FirestoreImportError('authorized must be 0, 1 or 2');
}

export function lifecycle(raw: unknown, warnings: string[]): string {
  const s = str(raw);
  if (s === null) return 'ABIERTO';
  const u = s.toUpperCase();
  if ((LIFECYCLES as readonly string[]).includes(u)) return u;
  warnings.push('unknown status; imported as ABIERTO');
  return 'ABIERTO';
}

/** ISO-8601 OffsetDateTime string, or a raw Firestore Timestamp map {_seconds|seconds, _nanoseconds|nanoseconds}. */
export function time(raw: unknown): Micros | null {
  if (typeof raw === 'string' && javaTrim(raw).length > 0) {
    const t = javaTrim(raw);
    // ISO_OFFSET_DATE_TIME: an offset is required.
    return /(Z|[+-]\d{2}:\d{2}(:\d{2})?)$/i.test(t) ? parseIsoInstant(t) : null;
  }
  if (isMap(raw)) {
    const sec = '_seconds' in raw ? raw._seconds : raw.seconds;
    const nanos = '_nanoseconds' in raw ? raw._nanoseconds : raw.nanoseconds;
    if (typeof sec === 'number') {
      const ns = typeof nanos === 'number' ? Math.trunc(nanos) : 0;
      return Math.trunc(sec) * 1_000_000 + Math.floor(ns / 1000);
    }
  }
  return null;
}

/** Never splits a surrogate pair. */
export function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const c = value.charCodeAt(max - 1);
  const end = c >= 0xd800 && c <= 0xdbff ? max - 1 : max;
  return value.slice(0, end);
}

function truncate(value: string, max: number, field: string, warnings: string[]): string {
  if (value.length <= max) return value;
  warnings.push(`${field} longer than ${max} characters truncated`);
  return cut(value, max);
}

/** stringMap: keys that are trimmed non-empty strings (HashMap: no stable order; callers sort when it matters). */
function stringMap(raw: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    const key = str(k);
    if (key !== null) out.set(key, v);
  }
  return out;
}

export interface LegacyComment { parentIndex: number | null; authorUid: string | null; body: string | null; at: Micros; key: string }

export function flattenComments(raw: unknown, fallback: Micros): LegacyComment[] {
  const out: LegacyComment[] = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Map<string, number>();
  for (const top of raw) {
    if (!isMap(top)) continue;
    const topIndex = out.length;
    const topKey = add(out, seen, null, '', top, fallback);
    addReplies(out, seen, topIndex, topKey, top.replies, fallback);
  }
  return out;
}

function addReplies(out: LegacyComment[], seen: Map<string, number>, topIndex: number, topKey: string, raw: unknown, fallback: Micros) {
  if (!Array.isArray(raw)) return;
  for (const r of raw) {
    if (!isMap(r)) continue;
    add(out, seen, topIndex, topKey, r, fallback);
    addReplies(out, seen, topIndex, topKey, r.replies, fallback);
  }
}

function add(out: LegacyComment[], seen: Map<string, number>, parentIndex: number | null, parentKey: string, m: Record<string, unknown>, fallback: Micros): string {
  const author = str(m.author);
  const rawTime = m.dateTime;
  const at = time(rawTime);
  // Java string concatenation: a null author prints "null".
  const base = `${parentKey}/${author === null ? 'null' : author}@${rawTime === null || rawTime === undefined ? '' : javaToString(rawTime)}`;
  const ordinal = (seen.get(base) ?? 0) + 1;
  seen.set(base, ordinal);
  const key = `${base}#${ordinal}`;
  out.push({ parentIndex, authorUid: author, body: str(m.comment), at: at ?? fallback, key });
  return key;
}

// ----------------------------------------------------------------- importer

export class ProposalFirestoreImporter {
  constructor(
    private readonly rows: ProposalImportRows,
    private readonly users: ImportUsers,
    private readonly aliasGenerator: Pick<ProposalAliasGenerator, 'next'>,
    private readonly now: () => Micros,
    private readonly hmac: ContentHmac,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  /** Stable for a (document, comment key) under the same root secret; a version-4-shaped UUID. */
  commentId(documentId: string, key: string): string {
    const d = this.hmac.sign(FIRESTORE_COMMENT_IDS, `${documentId}:${key}`);
    d[6] = (d[6]! & 0x0f) | 0x40;
    d[8] = (d[8]! & 0x3f) | 0x80;
    const h = Buffer.from(d.slice(0, 16)).toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async importProposal(documentId: string, doc: Record<string, unknown>, warnings: string[]): Promise<Outcome> {
    const id = proposalId(documentId);
    let title = str(doc.title);
    if (title === null) throw new FirestoreImportError('missing title');
    title = truncate(title, MAX_TITLE, 'title', warnings);
    const rawDescription = str(doc.description);
    const description = rawDescription === null ? '' : truncate(rawDescription, MAX_DESCRIPTION, 'description', warnings);
    const topicValue = topic(doc.topic, warnings);
    const status = moderation(doc.authorized);
    const lifecycleValue = lifecycle(doc.status, warnings);
    const rawReason = status === 'REJECTED' ? str(doc.rejectionReason) : null;
    const reason = rawReason === null ? null : truncate(rawReason, MAX_REASON, 'rejectionReason', warnings);
    const now = this.now();
    let createdAt = time(doc.dateTime);
    if (createdAt === null) {
      warnings.push('missing or invalid dateTime; import time used');
      createdAt = now;
    }

    const comments = flattenComments(doc.comments, createdAt);
    const byUid = await this.resolveUsers(doc, comments);

    const authorId = lookup(byUid, doc.author);
    const authorUid = str(doc.author);
    if (authorId === null && authorUid !== null && await this.users.isDeletedFirebaseAccount(authorUid) && !(await this.rows.proposalExists(id))) {
      warnings.push('author deleted their account; proposal not re-imported');
      return 'SKIPPED';
    }
    if (authorId === null) warnings.push('author not imported; proposal kept without author');
    const moderatedBy = status === 'PENDING' ? null : lookup(byUid, doc.mod);

    const created = await this.rows.insertProposal(id, authorId, title, description, topicValue, status, lifecycleValue, reason, moderatedBy, createdAt);
    if (!created) await this.rows.lockProposal(id);
    let changed = false;

    const aliases = new Aliases(id, await this.rows.aliases(id), this.rows, this.aliasGenerator);
    changed = (await importUserNames(doc.userNames, byUid, aliases)) || changed;
    if (authorId !== null) changed = (await aliases.ensure(authorId, null)) || changed;
    changed = (await this.importVotes(doc.votes, byUid, id, createdAt, warnings)) || changed;
    changed = (await this.importComments(documentId, id, comments, byUid, aliases, warnings)) || changed;
    changed = (await this.importAttachments(doc.filesURL, id, warnings)) || changed;

    await this.rows.recomputeCounters(id);
    if (created) return 'CREATED';
    return changed ? 'UPDATED' : 'SKIPPED';
  }

  private async resolveUsers(doc: Record<string, unknown>, comments: LegacyComment[]): Promise<Map<string, string>> {
    const uids = new Set<string>();
    const addIf = (v: string | null) => { if (v !== null) uids.add(v); };
    addIf(str(doc.author));
    addIf(str(doc.mod));
    if (isMap(doc.votes)) Object.keys(doc.votes).forEach((k) => addIf(str(k)));
    if (isMap(doc.userNames)) Object.keys(doc.userNames).forEach((k) => addIf(str(k)));
    comments.forEach((c) => addIf(c.authorUid));
    if (uids.size === 0) return new Map();
    return this.users.findByFirebaseUidIn([...uids]);
  }

  private async importVotes(raw: unknown, byUid: Map<string, string>, id: string, fallback: Micros, warnings: string[]): Promise<boolean> {
    if (raw === null || raw === undefined) return false;
    if (!isMap(raw)) {
      warnings.push('votes is not a map; ignored');
      return false;
    }
    let changed = false;
    let unknownVoters = 0;
    let invalid = 0;
    for (const [uid, v] of stringMap(raw)) {
      const userId = byUid.get(uid);
      if (userId === undefined) {
        unknownVoters++;
        continue;
      }
      const like = isMap(v) ? v.like : null;
      if (typeof like !== 'boolean') {
        invalid++;
        continue;
      }
      const at = time((v as Record<string, unknown>).timestamp);
      changed = (await this.rows.insertVote(id, userId, like ? 'UP' : 'DOWN', at ?? fallback)) || changed;
    }
    if (unknownVoters > 0) warnings.push(`${unknownVoters} votes by users not imported dropped`);
    if (invalid > 0) warnings.push(`${invalid} malformed votes dropped`);
    return changed;
  }

  private async importComments(documentId: string, id: string, comments: LegacyComment[], byUid: Map<string, string>,
    aliases: Aliases, warnings: string[]): Promise<boolean> {
    let changed = false;
    let unknownAuthors = 0;
    let blank = 0;
    let truncated = 0;
    const ids: string[] = [];
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i]!;
      ids[i] = this.commentId(documentId, c.key);
      const parentId = c.parentIndex === null ? null : ids[c.parentIndex]!;
      if (c.body === null) {
        // A blank top-level comment still anchors its replies, as a tombstone.
        blank++;
        if (c.parentIndex !== null || !comments.some((x) => x.parentIndex === i && x.body !== null)) continue;
      }
      const authorId = lookup(byUid, c.authorUid);
      if (authorId === null) unknownAuthors++;
      else changed = (await aliases.ensure(authorId, null)) || changed;
      let body = c.body;
      if (body !== null && body.length > MAX_COMMENT) {
        body = cut(body, MAX_COMMENT);
        truncated++;
      }
      if (body === null) changed = (await this.rows.insertDeletedComment(ids[i]!, id, parentId, c.at)) || changed;
      else changed = (await this.rows.insertComment(ids[i]!, id, authorId, parentId, body, c.at)) || changed;
    }
    if (unknownAuthors > 0) warnings.push(`${unknownAuthors} comments by users not imported kept without author`);
    if (blank > 0) warnings.push(`${blank} blank comments dropped`);
    if (truncated > 0) warnings.push(`${truncated} comments longer than ${MAX_COMMENT} characters truncated`);
    return changed;
  }

  private async importAttachments(raw: unknown, id: string, warnings: string[]): Promise<boolean> {
    if (!Array.isArray(raw)) return false;
    let changed = false;
    let position = 0;
    let notCopied = 0;
    let invalid = 0;
    for (const k of raw) {
      const key = str(k);
      if (key === null) continue;
      const m = LEGACY_ATTACHMENT_KEY.exec(key);
      if (!m) {
        if (key.startsWith('https://') || key.startsWith('http://')) notCopied++;
        else invalid++;
        continue;
      }
      changed = (await this.rows.insertAttachment(id, position++, key, CONTENT_TYPES[m[1]!]!)) || changed;
    }
    if (notCopied > 0) warnings.push(`${notCopied} filesURL entries not copied to object storage dropped (re-export with --copy-attachments)`);
    if (invalid > 0) warnings.push(`${invalid} malformed filesURL entries dropped`);
    return changed;
  }
}

function lookup(byUid: Map<string, string>, uid: unknown): string | null {
  const key = str(uid);
  return key === null ? null : byUid.get(key) ?? null;
}

/** The proposal's aliases, kept unique while the import adds to them. */
class Aliases {
  private readonly byUser: Map<string, string>;
  private readonly taken: Set<string>;
  constructor(private readonly proposalId: string, existing: Map<string, string>, private readonly rows: ProposalImportRows,
    private readonly generator: Pick<ProposalAliasGenerator, 'next'>) {
    this.byUser = new Map(existing);
    this.taken = new Set(existing.values());
  }

  /** `preferred` when usable and free, a generated alias otherwise. True when inserted. */
  async ensure(userId: string, preferred: string | null): Promise<boolean> {
    if (this.byUser.has(userId)) return false;
    let alias = preferred;
    if (alias === null || alias.length > MAX_ALIAS || this.taken.has(alias)) alias = this.generator.next(new Set(this.taken));
    this.byUser.set(userId, alias);
    this.taken.add(alias);
    return this.rows.insertAlias(this.proposalId, userId, alias);
  }
}

/** userNames sorted by uid (TreeMap) so a re-run makes the same choices. */
async function importUserNames(raw: unknown, byUid: Map<string, string>, aliases: Aliases): Promise<boolean> {
  if (!isMap(raw)) return false;
  let changed = false;
  const names = stringMap(raw);
  for (const uid of [...names.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const userId = byUid.get(uid);
    if (userId !== undefined) changed = (await aliases.ensure(userId, str(names.get(uid)))) || changed;
  }
  return changed;
}

/** For report/debug output: an import timestamp as OffsetDateTime text (UTC). */
export const isoUtc = (us: Micros) => formatOffsetDateTime(us, 'UTC');
