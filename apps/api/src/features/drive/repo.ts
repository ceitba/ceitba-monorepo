// The drive feature's queries. Session (session.ts) stays the unit of work: entities
// come back managed through s.queryFiles / s.querySources (identity map, dirty
// checking, auto flush before each query), so every function here takes the Session.
// Plain rows (counts, reports, subjects, users) come back as data.

import { sql, type SQL } from 'drizzle-orm';
import type { DriveFile, DriveSource } from './model';
import type { Session } from './session';

type Row = Record<string, unknown>;

/** `(id1::uuid, id2::uuid, ...)` */
const uuids = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;
/** `(v1, v2, ...)` */
const texts = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
const count = async (s: Session, q: SQL): Promise<number> => Number((await s.rows(q))[0]!.n);

// ---- sources ------------------------------------------------------------------------------

export const sourcesByIds = (s: Session, ids: string[]): Promise<DriveSource[]> => s.querySources(sql`s.id IN ${uuids(ids)}`);

export const sourceOwnedBy = async (s: Session, sourceId: string, userId: string): Promise<DriveSource | undefined> =>
  (await s.querySources(sql`s.id = ${sourceId} AND s.user_id = ${userId}`))[0];

/** The user's sources, locked (FOR UPDATE). */
export const lockSourcesOfUser = (s: Session, userId: string): Promise<DriveSource[]> => s.querySources(sql`s.user_id = ${userId}`, sql`FOR UPDATE`);

/** The user's connected (not DISCONNECTED) sources, newest first. */
export const connectedSourcesOfUser = (s: Session, userId: string): Promise<DriveSource[]> =>
  s.querySources(sql`s.user_id = ${userId} AND s.status <> 'DISCONNECTED'`, sql`ORDER BY s.created_at DESC`);

/** The user's connected source of `folderId`, or null. */
export const connectedSourceOfFolder = async (s: Session, userId: string, folderId: string): Promise<DriveSource | null> =>
  (await s.querySources(sql`s.user_id = ${userId} AND s.root_folder_id = ${folderId} AND s.status <> 'DISCONNECTED'`, sql`LIMIT 1`))[0] ?? null;

export const countBlockedSourcesOfFolder = (s: Session, folderId: string): Promise<number> =>
  count(s, sql`SELECT count(*)::int AS n FROM wiki.drive_source WHERE root_folder_id = ${folderId} AND status = 'BLOCKED'`);

export const countActiveSourcesOfUser = (s: Session, userId: string): Promise<number> =>
  count(s, sql`SELECT count(*)::int AS n FROM wiki.drive_source WHERE user_id = ${userId} AND status = 'ACTIVE'`);

/** status null: every source except DISCONNECTED. */
const staffSourceFilter = (status: string | null) => (status == null ? sql`s.status <> 'DISCONNECTED'` : sql`s.status = ${status}`);

/** The staff list: newest first, one page. */
export const staffSourcesPage = (s: Session, status: string | null, size: number, offset: number): Promise<DriveSource[]> =>
  s.querySources(staffSourceFilter(status), sql`ORDER BY s.created_at DESC LIMIT ${size} OFFSET ${offset}`);

export const countStaffSources = (s: Session, status: string | null): Promise<number> =>
  count(s, sql`SELECT count(*)::int8 AS n FROM wiki.drive_source s WHERE ${staffSourceFilter(status)}`);

// ---- files --------------------------------------------------------------------------------

export const filesByIds = (s: Session, ids: string[]): Promise<DriveFile[]> => s.queryFiles(sql`f.id IN ${uuids(ids)}`);

export const filesOfSources = (s: Session, sourceIds: string[]): Promise<DriveFile[]> => s.queryFiles(sql`f.source_id IN ${uuids(sourceIds)}`);

export const foldersOfSources = (s: Session, sourceIds: string[]): Promise<DriveFile[]> =>
  s.queryFiles(sql`f.kind = 'FOLDER' AND f.source_id IN ${uuids(sourceIds)}`);

/** A subject's published files, by name. */
export const publishedFilesOfSubject = (s: Session, subjectId: string): Promise<DriveFile[]> =>
  s.queryFiles(sql`f.effective_subject_id = ${subjectId} AND f.publication = 'PUBLISHED'`, sql`ORDER BY f.name ASC`);

const staffFileFilter = (publication: string) =>
  sql`f.publication = ${publication} AND f.source_id IN (SELECT id FROM wiki.drive_source WHERE status <> 'PENDING_REVIEW')`;

/** The staff queue: files with `publication` of reviewed sources, most recently updated first, one page. */
export const staffFilesPage = (s: Session, publication: string, size: number, offset: number): Promise<DriveFile[]> =>
  s.queryFiles(staffFileFilter(publication), sql`ORDER BY f.updated_at DESC, f.id LIMIT ${size} OFFSET ${offset}`);

export const countStaffFiles = (s: Session, publication: string): Promise<number> =>
  count(s, sql`SELECT count(*)::int8 AS n FROM wiki.drive_file f WHERE ${staffFileFilter(publication)}`);

/**
 * Reprocess: clears content_modified_at of the live, exported files of `kind` (the next sync re-exports them).
 * Returns the sources they belong to (read first) and how many files were marked.
 */
export async function markForReexport(s: Session, kind: string): Promise<{ sourceIds: string[]; files: number }> {
  const cond = sql`kind = ${kind} AND removed_at IS NULL AND content_fingerprint IS NOT NULL AND export_blocked = false`;
  const sourceIds = (await s.rows(sql`SELECT DISTINCT source_id FROM wiki.drive_file WHERE ${cond}`)).map((r) => r.source_id as string);
  const rows = await s.rows(sql`UPDATE wiki.drive_file SET content_modified_at = NULL WHERE ${cond} RETURNING id`);
  return { sourceIds, files: rows.length };
}

/** File counts per source: files (live, not folders), published, needing review. */
export async function fileCountsBySource(s: Session, sourceIds: string[]): Promise<Row[]> {
  return s.rows(sql`SELECT source_id,
        sum(CASE WHEN kind <> 'FOLDER' AND removed_at IS NULL THEN 1 ELSE 0 END)::int8 AS files,
        sum(CASE WHEN publication = 'PUBLISHED' THEN 1 ELSE 0 END)::int8 AS published,
        sum(CASE WHEN publication = 'NEEDS_REVIEW' THEN 1 ELSE 0 END)::int8 AS review
      FROM wiki.drive_file WHERE source_id IN (${sql.join(sourceIds.map((i) => sql`${i}::uuid`), sql`, `)}) GROUP BY source_id`);
}

/** Published files per subject (id, n, last) among `subjectIds`. */
export const publishedStatsOfSubjects = (s: Session, subjectIds: string[]): Promise<Row[]> =>
  s.rows(sql`SELECT effective_subject_id AS id, count(*)::int8 AS n, max(coalesce(drive_modified_at, published_at)) AS last
        FROM wiki.drive_file WHERE publication = 'PUBLISHED' AND effective_subject_id IN (${sql.join(subjectIds.map((i) => sql`${i}`), sql`, `)})
        GROUP BY effective_subject_id`);

/** The `limit` subjects with published files most recently updated (id, n, last). */
export const recentlyUpdatedSubjects = (s: Session, limit: number): Promise<Row[]> =>
  s.rows(sql`SELECT effective_subject_id AS id, count(*)::int8 AS n, max(coalesce(drive_modified_at, published_at)) AS last
          FROM wiki.drive_file WHERE publication = 'PUBLISHED' AND effective_subject_id IS NOT NULL
          GROUP BY effective_subject_id ORDER BY max(coalesce(drive_modified_at, published_at)) DESC NULLS LAST LIMIT ${limit}`);

// ---- reports ------------------------------------------------------------------------------

export const deleteReportsOfFile = (s: Session, fileId: string): Promise<Row[]> =>
  s.rows(sql`DELETE FROM wiki.drive_file_report WHERE file_id = ${fileId}`);

export const reportedFileIdsOfUser = async (s: Session, userId: string): Promise<string[]> =>
  (await s.rows(sql`SELECT file_id FROM wiki.drive_file_report WHERE user_id = ${userId}`)).map((r) => r.file_id as string);

export const deleteReportsOfUser = (s: Session, userId: string): Promise<Row[]> =>
  s.rows(sql`DELETE FROM wiki.drive_file_report WHERE user_id = ${userId}`);

export const countReportsOfFile = (s: Session, fileId: string): Promise<number> =>
  count(s, sql`SELECT count(*)::int AS n FROM wiki.drive_file_report WHERE file_id = ${fileId}`);

export const countReportsOfFileBy = (s: Session, fileId: string, userId: string): Promise<number> =>
  count(s, sql`SELECT count(*)::int AS n FROM wiki.drive_file_report WHERE file_id = ${fileId} AND user_id = ${userId}`);

/** The reports of `fileIds`, newest first (file_id, reason, comment, created_at). */
export const reportsOfFiles = (s: Session, fileIds: string[]): Promise<Row[]> =>
  s.rows(sql`SELECT file_id, reason, comment, created_at FROM wiki.drive_file_report
        WHERE file_id IN ${uuids(fileIds)} ORDER BY created_at DESC`);

/** One report per (file, user): a repeat replaces the reason, comment and time. */
export const upsertReport = (s: Session, fileId: string, userId: string, reason: string | null, comment: string | null, at: string | null): Promise<Row[]> =>
  s.rows(sql`INSERT INTO wiki.drive_file_report (file_id, user_id, reason, comment, created_at)
        VALUES (${fileId}, ${userId}, ${reason}, ${comment}, ${at}::timestamptz)
        ON CONFLICT (file_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, comment = EXCLUDED.comment, created_at = EXCLUDED.created_at`);

// ---- unclaimed shares ---------------------------------------------------------------------

export const unclaimedShares = (s: Session): Promise<Row[]> =>
  s.rows(sql`SELECT name, owner_email, first_seen_at, last_seen_at
        FROM wiki.drive_unclaimed_share ORDER BY last_seen_at DESC`);

export const deleteUnclaimedShare = (s: Session, driveId: string): Promise<Row[]> =>
  s.rows(sql`DELETE FROM wiki.drive_unclaimed_share WHERE drive_id = ${driveId}`);

// ---- other features' tables (read) --------------------------------------------------------

export const usersByIds = (s: Session, ids: string[]): Promise<Row[]> =>
  s.rows(sql`SELECT id, email, name, plan FROM public."user" WHERE id IN (${sql.join(ids.map((w) => sql`${w}::uuid`), sql`, `)})`);

export const subjectsByIds = (s: Session, ids: string[]): Promise<Row[]> =>
  s.rows(sql`SELECT id, name FROM public.subject WHERE id IN ${texts(ids)}`);

export const subjectById = async (s: Session, id: string): Promise<Row | undefined> =>
  (await s.rows(sql`SELECT id, name FROM public.subject WHERE id = ${id}`))[0];

export const allSubjects = (s: Session): Promise<Row[]> => s.rows(sql`SELECT id, name FROM public.subject`);

export const subjectExists = async (s: Session, id: string): Promise<boolean> =>
  (await count(s, sql`SELECT count(*)::int AS n FROM public.subject WHERE id = ${id}`)) > 0;

/** The plan's entries (subject_id, year, semester, section; no year/semester = 0), in plan order: a subject may repeat. */
export const planEntries = (s: Session, planId: string): Promise<Row[]> =>
  s.rows(sql`SELECT subject_id, COALESCE(year, 0) AS year, COALESCE(semester, 0) AS semester, section
    FROM public.plan_entry_effective WHERE plan_id = ${planId} ORDER BY position`);

/** Which of `subjectIds` have a published wiki page. */
export const subjectsWithPublishedWiki = async (s: Session, subjectIds: string[]): Promise<Set<string>> =>
  new Set((await s.rows(sql`SELECT DISTINCT subject_id FROM wiki.kb_page WHERE subject_id IN (${sql.join(subjectIds.map((i) => sql`${i}`), sql`, `)})
      AND status IN ('PUBLISHED')`)).map((r) => r.subject_id as string));
