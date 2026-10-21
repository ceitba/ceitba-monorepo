// service/kb/KbImportService: POST /v1/staff/kb/subjects/{subjectId}/import
// (docs/SUBJECT-WIKI.md); the route itself is StaffKbController's (kb-admin),
// the pipeline (kb-pipeline) calls validate()/importSubject() too. One
// transaction:
//   - each page is parsed and validated; a rejected page keeps its previous revision;
//   - an accepted page is created (revision 1) or, when its content changed, its
//     previous version goes to kb_page_revision and `revision` goes up; a REMOVED
//     page comes back as PUBLISHED, a HIDDEN one stays hidden;
//   - its wikilinks replace its kb_link rows;
//   - replace=true: pages of the subject whose slug is not in the payload
//     (rejected ones count as present) become REMOVED;
//   - finally every link from or to the subject is resolved again.

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import { javaCompareStrings } from '../../lib/javaCompat';
import { parsePgTimestamp, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { Shingles } from '../kb/logic/kbCopyDetector';
import * as linker from '../kb/logic/kbLinker';
import * as parser from '../kb/logic/kbPageParser';
import type { Draft } from '../kb/logic/kbPageParser';
import * as validator from '../kb/logic/kbValidator';
import * as wikilinks from '../kb/logic/kbWikilinks';
import type { Odt } from '../kb/logic/odt';
import type { KbImportPage, KbImportResponse, KbRejectedPage } from './dto';
import * as repo from './repo';
import type { KbPageRow } from './repo';

/** The outcome of validating a payload without writing anything. accepted is keyed by slug, in payload order. */
export interface KbImportValidation {
  accepted: Map<string, Draft>;
  rejected: KbRejectedPage[];
  payloadSlugs: Set<string | null>;
}

/** Postgres literal of a parsed frontmatter date (pgjdbc rounds to microseconds). */
export function odtToPg(t: Odt): string {
  return toPgTimestamp(t.epochSecond * 1_000_000 + Math.round(t.nano / 1000));
}

/** OffsetDateTime.isEqual(entity value read from the database). */
function sameInstant(draft: Odt, pg: string): boolean {
  const us = parsePgTimestamp(pg);
  const sec = Math.floor(us / 1_000_000);
  return draft.epochSecond === sec && draft.nano === (us - sec * 1_000_000) * 1000;
}

const eqList = (a: readonly (string | null)[], b: readonly (string | null)[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** KbPage.differsFrom. */
function differs(p: KbPageRow, d: Draft): boolean {
  return p.type !== d.type || d.title !== p.title || d.summary !== p.summary || !eqList(d.aliases, p.aliases)
    || d.body !== p.markdown || !eqList(d.sources, p.sources) || d.generator !== p.generator
    || !sameInstant(d.generatedAt, p.generatedAt);
}

const truncate = (s: string, max: number) => (s.length <= max ? s : s.substring(0, max));

export class KbImportService {
  constructor(private readonly deps: Pick<Deps, 'db' | 'log'>) {}

  /**
   * Parses and validates a payload against the current database (sources,
   * anchors, concept coverage). Writes nothing. removing: slugs about to be
   * removed (not linkable, not coverage targets). `db`: join the caller's transaction.
   */
  validate(subjectId: string, payload: KbImportPage[], removing: ReadonlySet<string> = new Set(), db?: Db): Promise<KbImportValidation> {
    return withTx(db ?? this.deps.db, (tx) => this.validateIn(tx, subjectId, payload, removing), { readOnly: true });
  }

  private async validateIn(tx: Db, subjectId: string, payload: KbImportPage[], removing: ReadonlySet<string>): Promise<KbImportValidation> {
    const entries: { slug: string | null; parsed: parser.Result }[] = [];
    const payloadSlugs = new Set<string | null>();
    const sourceIds = new Set<string>();
    for (const p of payload) {
      let parsed = parser.parse(p.path, p.content, subjectId);
      const slug = parser.slugOf(p.path);
      if (payloadSlugs.has(slug)) {
        parsed = new parser.Result(null, ['duplicate slug in this import', ...parsed.errors]);
      } else {
        payloadSlugs.add(slug);
      }
      if (parsed.ok()) for (const s of parsed.draft!.sources) sourceIds.add(s);
      entries.push({ slug, parsed });
    }
    const sourceInfo = new Map<string, validator.SourceInfo>();
    for (const f of await repo.sourceFiles(tx, [...sourceIds])) {
      sourceInfo.set(f.id, validator.sourceInfo(f.id, f.publication === 'PUBLISHED', f.effectiveSubjectId, f.textContent,
        f.contentFingerprint != null ? f.contentFingerprint : `file:${f.id}`));
    }

    // Headings of the pages in this payload (they win over stored ones).
    const payloadAnchors = new Map<string | null, Set<string>>();
    // The subject's pages after this import, for the coverage rule (a TreeMap by slug).
    const targets = new Map<string, linker.Target>();
    for (const page of await repo.pagesBySubject(tx, subjectId)) {
      if (page.status !== 'REMOVED' && !payloadSlugs.has(page.slug) && !removing.has(page.slug)) {
        targets.set(page.slug, { slug: page.slug, title: page.title, aliases: [...page.aliases] });
      }
    }
    for (const e of entries) {
      if (!e.parsed.ok()) continue;
      const d = e.parsed.draft!;
      payloadAnchors.set(e.slug, wikilinks.headingAnchors(d.body));
      targets.set(d.slug, { slug: d.slug, title: d.title, aliases: d.aliases });
    }
    const targetList = [...targets.keys()].sort(javaCompareStrings).map((k) => targets.get(k)!);

    const accepted = new Map<string, Draft>();
    const rejected: KbRejectedPage[] = [];
    const shingles = new Map<string, Shingles>();   // each source's, built once
    for (const e of entries) {
      if (!e.parsed.ok()) {
        rejected.push({ slug: e.slug, errors: [...e.parsed.errors] });
        continue;
      }
      const draft = e.parsed.draft!;
      const errors = [...validator.validate(draft, sourceInfo, shingles)];
      errors.push(...(await this.anchorErrors(tx, subjectId, draft, payloadAnchors)));
      for (const m of linker.unlinked(draft.body, draft.slug, targetList)) {
        errors.push(`unlinked mention of '${m.text}': link it as [[${m.slug}|${m.text}]]`);
      }
      if (errors.length > 0) {
        rejected.push({ slug: e.slug, errors });
        continue;
      }
      accepted.set(draft.slug, draft);
    }
    return { accepted, rejected, payloadSlugs };
  }

  /** @Transactional; `db`: join the caller's transaction (the pipeline's publish step). */
  importSubject(subjectId: string, req: { pages: KbImportPage[]; replace: boolean }, db?: Db): Promise<KbImportResponse> {
    return withTx(db ?? this.deps.db, async (tx) => {
      if (!(await repo.subjectExists(tx, subjectId))) throw new ResourceNotFoundError('Subject', subjectId);
      const v = await this.validateIn(tx, subjectId, req.pages, new Set());

      const existing = new Map<string, KbPageRow>();
      for (const page of await repo.pagesBySubject(tx, subjectId)) existing.set(page.slug, page);
      const accepted: string[] = [];
      for (const draft of v.accepted.values()) {
        await this.upsert(tx, subjectId, draft, existing.get(draft.slug) ?? null);
        accepted.push(draft.slug);
      }

      const removed: string[] = [];
      if (req.replace) {
        for (const page of existing.values()) {
          if (v.payloadSlugs.has(page.slug) || page.status === 'REMOVED') continue;
          await repo.updatePageState(tx, page.id, { status: 'REMOVED', hiddenReason: null, reportCount: page.reportCount }, toPgTimestamp(systemNowMicros()));
          removed.push(page.slug);
        }
        removed.sort(javaCompareStrings);
      }

      await repo.resolveLinksForSubject(tx, subjectId);
      this.deps.log.info(`KB import ${subjectId}: ${accepted.length} accepted, ${v.rejected.length} rejected, ${removed.length} removed`);
      return { accepted, rejected: v.rejected, removed };
    });
  }

  // A #anchor must name a ## to #### heading of its target page when that
  // page exists (in this payload, else stored and not REMOVED); links to
  // pages that do not exist yet stay unresolved, as without anchors.
  private async anchorErrors(tx: Db, subjectId: string, draft: Draft, payloadAnchors: Map<string | null, Set<string>>): Promise<string[]> {
    const errors: string[] = [];
    for (const l of draft.links.links) {
      if (l.anchor == null) continue;
      let anchors: Set<string>;
      if (l.subjectId === subjectId && payloadAnchors.has(l.slug)) {
        anchors = payloadAnchors.get(l.slug)!;
      } else {
        const target = await repo.pageBySubjectAndSlug(tx, l.subjectId, l.slug);
        if (!target || target.status === 'REMOVED') continue;
        anchors = wikilinks.headingAnchors(target.markdown);
      }
      if (!anchors.has(l.anchor)) {
        errors.push(`link [[${l.raw}]]: no heading '#${l.anchor}' in ${l.subjectId}/${l.slug}`);
      }
    }
    return errors;
  }

  private async upsert(tx: Db, subjectId: string, d: Draft, page: KbPageRow | null): Promise<void> {
    const now = toPgTimestamp(systemNowMicros());
    const content: repo.PageContent = {
      type: d.type, title: d.title, summary: d.summary, aliases: [...d.aliases], markdown: d.body, sources: [...d.sources],
      generator: d.generator, generatedAt: odtToPg(d.generatedAt),
    };
    let pageId: string;
    if (page == null) {
      pageId = crypto.randomUUID();
      await repo.insertPage(tx, pageId, subjectId, d.slug, content, now);
    } else {
      pageId = page.id;
      const changed = differs(page, d);
      if (changed) await repo.insertRevision(tx, page, now);
      const revision = changed ? page.revision + 1 : page.revision;
      const revived = page.status === 'REMOVED';
      if (changed || revived) {
        // Hibernate writes the row only when dirty (then @UpdateTimestamp moves).
        const c = changed ? content : {
          type: page.type, title: page.title, summary: page.summary, aliases: page.aliases, markdown: page.markdown,
          sources: page.sources, generator: page.generator, generatedAt: page.generatedAt,
        };
        await repo.updatePage(tx, page.id, {
          ...c, revision, status: revived ? 'PUBLISHED' : page.status, hiddenReason: revived ? null : page.hiddenReason ?? null,
        }, now);
      }
      await repo.deleteLinksFrom(tx, page.id);
    }
    for (const l of d.links.links) {
      await repo.insertLink(tx, pageId, truncate(l.raw, 256), truncate(l.subjectId, 25), truncate(l.slug, 128));
    }
  }
}
