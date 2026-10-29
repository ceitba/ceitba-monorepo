// repository/kb/{KbPageRepository, KbLinkRepository, KbPageReportRepository,
// KbRelationRepository, KbPageChunkRepository, KbPageRevisionRepository} and the
// Drive/subject/user lookups KbViews and KbImportService make (drizzle). Rows
// never leave the services. Spring Data derived queries have no ORDER BY, so
// neither do these (the services sort like Java).

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { subject } from '../../db/schema/academic';
import { driveFileInWiki, driveSourceInWiki } from '../../db/schema/drive';
import { user } from '../../db/schema/identity';
import {
  kbEvalSetInWiki, kbFileDigestInWiki, kbLinkInWiki, kbPageInWiki, kbPageReportInWiki, kbPageRevisionInWiki,
} from '../../db/schema/kb';

export type KbPageRow = typeof kbPageInWiki.$inferSelect;
export type KbLinkRow = typeof kbLinkInWiki.$inferSelect;
export type KbPageStatus = 'PUBLISHED' | 'HIDDEN' | 'REMOVED';

const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

// ------------------------------------------------------------------ subjects

export async function findSubject(db: Db, id: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db.select({ id: subject.id, name: subject.name }).from(subject).where(eq(subject.id, id)).limit(1);
  return row ?? null;
}

export async function subjectExists(db: Db, id: string): Promise<boolean> {
  return (await findSubject(db, id)) !== null;
}

/** DriveViews.subjectNames / subjects.findAllById: id -> name. */
export async function subjectNames(db: Db, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const wanted = uniq([...ids].filter((x): x is string => x != null));
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// --------------------------------------------------------------------- pages

export function pagesBySubject(db: Db, subjectId: string): Promise<KbPageRow[]> {
  return db.select().from(kbPageInWiki).where(eq(kbPageInWiki.subjectId, subjectId));
}

export function pagesBySubjectAndStatusIn(db: Db, subjectId: string, statuses: readonly KbPageStatus[]): Promise<KbPageRow[]> {
  return db.select().from(kbPageInWiki)
    .where(and(eq(kbPageInWiki.subjectId, subjectId), inArray(kbPageInWiki.status, [...statuses])));
}

export async function pageBySubjectAndSlug(db: Db, subjectId: string, slug: string): Promise<KbPageRow | null> {
  const [row] = await db.select().from(kbPageInWiki)
    .where(and(eq(kbPageInWiki.subjectId, subjectId), eq(kbPageInWiki.slug, slug))).limit(1);
  return row ?? null;
}

export async function pageById(db: Db, id: string): Promise<KbPageRow | null> {
  const [row] = await db.select().from(kbPageInWiki).where(eq(kbPageInWiki.id, id)).limit(1);
  return row ?? null;
}

/** findAllById (null ids dropped; Hibernate's IN list, no order). */
export async function pagesByIds(db: Db, ids: Iterable<string | null>): Promise<KbPageRow[]> {
  const wanted = uniq([...ids].filter((x): x is string => x != null));
  if (wanted.length === 0) return [];
  return db.select().from(kbPageInWiki).where(inArray(kbPageInWiki.id, wanted));
}

/** select distinct p.subjectId ... where subjectId in :ids and status in :statuses. */
export async function subjectIdsWithPages(db: Db, ids: Iterable<string>, statuses: readonly KbPageStatus[]): Promise<string[]> {
  const wanted = uniq(ids);
  if (wanted.length === 0) return [];
  const rows = await db.selectDistinct({ s: kbPageInWiki.subjectId }).from(kbPageInWiki)
    .where(and(inArray(kbPageInWiki.subjectId, wanted), inArray(kbPageInWiki.status, [...statuses])));
  return rows.map((r) => r.s);
}

/** findByStatusOrderByUpdatedAtDescIdAsc(status, PageRequest.of(page, limit)) + its count. */
export async function pagesByStatus(db: Db, status: KbPageStatus, page: number, limit: number): Promise<{ rows: KbPageRow[]; total: number }> {
  const rows = await db.select().from(kbPageInWiki).where(eq(kbPageInWiki.status, status))
    .orderBy(desc(kbPageInWiki.updatedAt), asc(kbPageInWiki.id)).limit(limit).offset(page * limit);
  // Spring Data skips the count query when the first page is not full.
  if (page * limit === 0 && rows.length < limit) return { rows, total: rows.length };
  if (rows.length > 0 && rows.length < limit) return { rows, total: page * limit + rows.length };
  const [c] = await db.select({ n: count() }).from(kbPageInWiki).where(eq(kbPageInWiki.status, status));
  return { rows, total: Number(c?.n ?? 0) };
}

/** Takedown: PUBLISHED pages citing any of the files (sources && ids). */
export async function publishedCitingAny(db: Db, fileIds: string[]): Promise<KbPageRow[]> {
  const literal = `{${fileIds.join(',')}}`;
  return db.select().from(kbPageInWiki)
    .where(and(eq(kbPageInWiki.status, 'PUBLISHED'), sql`${kbPageInWiki.sources} && CAST(${literal} AS uuid[])`));
}

/** The moderation columns Hibernate's dirty check would write (+ @UpdateTimestamp). */
export async function updatePageState(db: Db, id: string, s: { status: string; hiddenReason: string | null; reportCount: number }, updatedAtPg: string): Promise<void> {
  await db.update(kbPageInWiki).set({ status: s.status, hiddenReason: s.hiddenReason, reportCount: s.reportCount, updatedAt: updatedAtPg })
    .where(eq(kbPageInWiki.id, id));
}

export interface PageContent {
  type: string;
  title: string;
  summary: string;
  aliases: string[];
  markdown: string;
  sources: string[];
  generator: string;
  /** Postgres timestamptz literal. */
  generatedAt: string;
}

export async function insertPage(db: Db, id: string, subjectId: string, slug: string, c: PageContent, nowPg: string): Promise<void> {
  await db.insert(kbPageInWiki).values({
    id, subjectId, slug, ...c, revision: 1, status: 'PUBLISHED', hiddenReason: null, reportCount: 0,
    createdAt: nowPg, updatedAt: nowPg,
  });
}

export async function updatePage(db: Db, id: string, c: PageContent & { revision: number; status: string; hiddenReason: string | null }, nowPg: string): Promise<void> {
  await db.update(kbPageInWiki).set({ ...c, updatedAt: nowPg }).where(eq(kbPageInWiki.id, id));
}

export async function insertRevision(db: Db, p: KbPageRow, nowPg: string): Promise<void> {
  await db.insert(kbPageRevisionInWiki).values({
    id: crypto.randomUUID(), pageId: p.id, revision: p.revision, type: p.type, title: p.title, summary: p.summary,
    aliases: p.aliases, markdown: p.markdown, sources: p.sources, generator: p.generator, generatedAt: p.generatedAt,
    createdAt: nowPg,
  });
}

// --------------------------------------------------------------------- links

export function linksFrom(db: Db, pageId: string): Promise<KbLinkRow[]> {
  return db.select().from(kbLinkInWiki).where(eq(kbLinkInWiki.fromPageId, pageId));
}

export async function linksFromIn(db: Db, ids: string[]): Promise<KbLinkRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(kbLinkInWiki).where(inArray(kbLinkInWiki.fromPageId, ids));
}

export function linksTo(db: Db, pageId: string): Promise<KbLinkRow[]> {
  return db.select().from(kbLinkInWiki).where(eq(kbLinkInWiki.toPageId, pageId));
}

export async function linksToIn(db: Db, ids: string[]): Promise<KbLinkRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(kbLinkInWiki).where(inArray(kbLinkInWiki.toPageId, ids));
}

export function linksToSubject(db: Db, subjectId: string): Promise<KbLinkRow[]> {
  return db.select().from(kbLinkInWiki).where(eq(kbLinkInWiki.toSubjectId, subjectId));
}

export async function deleteLinksFrom(db: Db, pageId: string): Promise<void> {
  await db.delete(kbLinkInWiki).where(eq(kbLinkInWiki.fromPageId, pageId));
}

export async function insertLink(db: Db, fromPageId: string, raw: string, toSubjectId: string, toSlug: string): Promise<void> {
  await db.insert(kbLinkInWiki).values({ id: crypto.randomUUID(), fromPageId, raw, toSubjectId, toSlug, toPageId: null });
}

/** KbLinkRepository.resolveForSubject. */
export async function resolveLinksForSubject(db: Db, subjectId: string): Promise<void> {
  await db.execute(sql`
    UPDATE wiki.kb_link l
    SET to_page_id = (SELECT p.id FROM wiki.kb_page p
                      WHERE p.subject_id = l.to_subject_id AND p.slug = l.to_slug)
    WHERE l.to_subject_id = ${subjectId}
       OR l.from_page_id IN (SELECT p.id FROM wiki.kb_page p WHERE p.subject_id = ${subjectId})`);
}

// ------------------------------------------------------------------- reports

export async function findReport(db: Db, pageId: string, userId: string): Promise<{ pageId: string } | null> {
  const [row] = await db.select({ pageId: kbPageReportInWiki.pageId }).from(kbPageReportInWiki)
    .where(and(eq(kbPageReportInWiki.pageId, pageId), eq(kbPageReportInWiki.userId, userId))).limit(1);
  return row ?? null;
}

export async function insertReport(db: Db, pageId: string, userId: string, reason: string, comment: string | null, atPg: string): Promise<void> {
  await db.insert(kbPageReportInWiki).values({ pageId, userId, reason, comment, createdAt: atPg });
}

export async function updateReport(db: Db, pageId: string, userId: string, reason: string, comment: string | null, atPg: string): Promise<void> {
  await db.update(kbPageReportInWiki).set({ reason, comment, createdAt: atPg })
    .where(and(eq(kbPageReportInWiki.pageId, pageId), eq(kbPageReportInWiki.userId, userId)));
}

export async function countReports(db: Db, pageId: string): Promise<number> {
  const [c] = await db.select({ n: count() }).from(kbPageReportInWiki).where(eq(kbPageReportInWiki.pageId, pageId));
  return Number(c?.n ?? 0);
}

export async function reportExists(db: Db, pageId: string, userId: string): Promise<boolean> {
  return (await findReport(db, pageId, userId)) !== null;
}

export async function deleteReportsOfPage(db: Db, pageId: string): Promise<void> {
  await db.delete(kbPageReportInWiki).where(eq(kbPageReportInWiki.pageId, pageId));
}

// ----------------------------------------------------------------- relations

export interface Relation { relatedId: string; reason: string; weight: number }

/** KbRelationRepository.findBySubject (ORDER BY weight DESC, related_id). */
export async function relationsOf(db: Db, subjectId: string): Promise<Relation[]> {
  const rows = await db.execute<{ related_id: string; reason: string; weight: number }>(sql`
    SELECT related_id, reason, weight FROM wiki.kb_subject_relation
    WHERE subject_id = ${subjectId} ORDER BY weight DESC, related_id`);
  return [...rows].map((r) => ({ relatedId: r.related_id, reason: r.reason, weight: Number(r.weight) }));
}

/** KbRelationRepository.refreshFromPlans: returns the PREREQUISITE pairs inserted. */
export async function refreshRelationsFromPlans(db: Db): Promise<number> {
  await db.execute(sql`DELETE FROM wiki.kb_subject_relation WHERE reason IN ('PREREQUISITE', 'DEPENDENT')`);
  const res = await db.execute(sql`
    INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
    SELECT ps.subject_id, d.dep, 'PREREQUISITE', count(DISTINCT ps.plan_id)
    FROM public.plan_entry_effective ps
    CROSS JOIN LATERAL unnest(ps.dependencies) AS d(dep)
    JOIN public.subject s1 ON s1.id = ps.subject_id
    JOIN public.subject s2 ON s2.id = d.dep
    WHERE d.dep <> ps.subject_id
    GROUP BY ps.subject_id, d.dep`);
  await db.execute(sql`
    INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
    SELECT related_id, subject_id, 'DEPENDENT', weight
    FROM wiki.kb_subject_relation WHERE reason = 'PREREQUISITE'`);
  return Number((res as unknown as { count?: number }).count ?? 0);
}

// --------------------------------------------------------- drive (read only)

export interface CitedFile {
  id: string;
  name: string;
  kind: string;
  publication: string;
  sourceId: string;
  academicYear: number | null;
  academicYearSource: string | null;
}

export function citedFiles(db: Db, ids: string[]): Promise<CitedFile[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const f = driveFileInWiki;
  return db.select({
    id: f.id, name: f.name, kind: f.kind, publication: f.publication, sourceId: f.sourceId,
    academicYear: f.academicYear, academicYearSource: f.academicYearSource,
  }).from(f).where(inArray(f.id, uniq(ids)));
}

export interface SourceFile {
  id: string;
  publication: string;
  effectiveSubjectId: string | null;
  textContent: string | null;
  contentFingerprint: string | null;
}

/** What KbValidator needs about the cited files of an import. */
export function sourceFiles(db: Db, ids: string[]): Promise<SourceFile[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const f = driveFileInWiki;
  return db.select({
    id: f.id, publication: f.publication, effectiveSubjectId: f.effectiveSubjectId, textContent: f.textContent,
    contentFingerprint: f.contentFingerprint,
  }).from(f).where(inArray(f.id, uniq(ids)));
}

export interface SourceRow { id: string; userId: string | null; kind: string; displayName: string | null; anonymous: boolean }

export function driveSources(db: Db, ids: string[]): Promise<SourceRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const s = driveSourceInWiki;
  return db.select({ id: s.id, userId: s.userId, kind: s.kind, displayName: s.displayName, anonymous: s.anonymous })
    .from(s).where(inArray(s.id, uniq(ids)));
}

/** DriveViews.usersById (null ids ignored): id -> name. */
export async function userNames(db: Db, ids: Iterable<string | null>): Promise<Map<string, string | null>> {
  const wanted = uniq([...ids].filter((x): x is string => x != null));
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ------------------------------------------------------- forgetFiles cleanup

export async function deleteDigestsOfFiles(db: Db, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await db.delete(kbFileDigestInWiki).where(inArray(kbFileDigestInWiki.fileId, fileIds));
}

/** KbRunRequestRepository.redactDigestRequests. */
export async function redactDigestRequests(db: Db, targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  await db.execute(sql`
    UPDATE wiki.kb_run_request SET params = CAST('{}' AS jsonb), result = NULL
    WHERE stage = 'DIGEST' AND target IN (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})`);
}

export function evalSetsFrozen(db: Db): Promise<{ id: string; frozenInputs: unknown }[]> {
  return db.select({ id: kbEvalSetInWiki.id, frozenInputs: kbEvalSetInWiki.frozenInputs }).from(kbEvalSetInWiki);
}

// ------------------------------------------------------- chunks (pgvector)

/** KbPageChunkRepository.findPageIdsToEmbed. */
export async function pageIdsToEmbed(db: Db, model: string, limit: number): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT p.id FROM wiki.kb_page p
    WHERE p.status = 'PUBLISHED'
      AND NOT EXISTS (SELECT 1 FROM wiki.kb_page_chunk c
                      WHERE c.page_id = p.id AND c.page_revision = p.revision AND c.model = ${model})
    ORDER BY p.updated_at, p.id
    LIMIT ${limit}`);
  return [...rows].map((r) => r.id);
}

export async function countPagesToEmbed(db: Db, model: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*) AS n FROM wiki.kb_page p
    WHERE p.status = 'PUBLISHED'
      AND NOT EXISTS (SELECT 1 FROM wiki.kb_page_chunk c
                      WHERE c.page_id = p.id AND c.page_revision = p.revision AND c.model = ${model})`);
  return Number([...rows][0]?.n ?? 0);
}

export async function deleteChunks(db: Db, pageId: string): Promise<void> {
  await db.execute(sql`DELETE FROM wiki.kb_page_chunk WHERE page_id = ${pageId}`);
}

export async function insertChunk(db: Db, c: { pageId: string; revision: number; ordinal: number; heading: string | null; anchor: string | null; content: string; model: string; embedding: string }): Promise<void> {
  await db.execute(sql`
    INSERT INTO wiki.kb_page_chunk (page_id, page_revision, ordinal, heading, anchor, content, model, embedding)
    VALUES (${c.pageId}, ${c.revision}, ${c.ordinal}, CAST(${c.heading} AS text), CAST(${c.anchor} AS varchar), ${c.content}, ${c.model},
            CAST(${c.embedding} AS vector))`);
}

export type NearestRow = {
  id: string; page_id: string; subject_id: string; slug: string; title: string; heading: string | null;
  anchor: string | null; content: string; distance: number;
};

/** KbPageChunkRepository.findNearest (the caller enables the iterative scan in the same transaction). */
export async function findNearest(db: Db, query: string, model: string, subjectId: string | null, k: number): Promise<NearestRow[]> {
  const rows = await db.execute<NearestRow>(sql`
    SELECT c.id, p.id AS page_id, p.subject_id, p.slug, p.title, c.heading, c.anchor, c.content,
           c.embedding <=> CAST(${query} AS vector) AS distance
    FROM wiki.kb_page_chunk c
    JOIN wiki.kb_page p ON p.id = c.page_id
    WHERE p.status = 'PUBLISHED' AND c.model = ${model}
      AND (CAST(${subjectId} AS varchar) IS NULL OR p.subject_id = CAST(${subjectId} AS varchar))
    ORDER BY c.embedding <=> CAST(${query} AS vector)
    LIMIT ${k}`);
  return [...rows];
}

/**
 * Transaction-local settings of a vector search: HNSW iterative scans (filters on top of the ANN order), and
 * custom plans only. postgres.js prepares the query, and after five runs Postgres may switch to the cached
 * generic plan, which cannot see the bound query vector and skips the HNSW index (368 ms vs 9.6 ms measured).
 */
export async function enableIterativeScan(db: Db): Promise<void> {
  await db.execute(sql`SELECT set_config('hnsw.iterative_scan', 'strict_order', true), set_config('plan_cache_mode', 'force_custom_plan', true)`);
}

