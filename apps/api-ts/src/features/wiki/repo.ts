// repository/wiki/SubjectBookmarkRepository + the two queries
// SubjectBookmarkService borrows from SubjectRepository, DriveFileRepository
// (publishedSubjectsIn) and KbPageRepository (findSubjectIdsWithPages).

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { subject } from '../../db/schema/academic';
import { subjectBookmarksInWiki as bookmarks } from '../../db/schema/wiki';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type BookmarkRow = typeof bookmarks.$inferSelect;

const n = (v: unknown) => Number(v ?? 0);

export async function countBySubjectId(db: Db, subjectId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(bookmarks).where(eq(bookmarks.subjectId, subjectId));
  return n(r?.n);
}

export async function countByUserId(db: Db, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(bookmarks).where(eq(bookmarks.userId, userId));
  return n(r?.n);
}

export async function exists(db: Db, subjectId: string, userId: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(bookmarks)
    .where(and(eq(bookmarks.subjectId, subjectId), eq(bookmarks.userId, userId)));
  return n(r?.n) > 0;
}

/** save(new SubjectBookmark(subjectId, userId)): updated_at = OffsetDateTime.now() (field initializer). */
export async function insert(db: Db, subjectId: string, userId: string, now: Micros): Promise<void> {
  await db.insert(bookmarks).values({ subjectId, userId, updatedAt: toPgTimestamp(now) });
}

export async function deleteBy(db: Db, subjectId: string, userId: string): Promise<void> {
  await db.delete(bookmarks).where(and(eq(bookmarks.subjectId, subjectId), eq(bookmarks.userId, userId)));
}

/** findByUserIdOrderByUpdatedAtDescSubjectIdAsc */
export function pinsOf(db: Db, userId: string): Promise<BookmarkRow[]> {
  return db.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.updatedAt), asc(bookmarks.subjectId));
}

/** subjects.findAllById(ids): id -> name. */
export async function subjectNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** DriveFileRepository.publishedSubjectsIn: published file count per effective subject. */
export async function publishedFileCounts(db: Db, ids: string[]): Promise<Map<string, number>> {
  const rows = await db.execute<{ s: string; n: string | number }>(sql`
    SELECT f.effective_subject_id AS s, count(f.id) AS n FROM wiki.drive_file f
    WHERE f.publication = 'PUBLISHED' AND f.effective_subject_id IN (${list(ids)})
    GROUP BY f.effective_subject_id`);
  return new Map((rows as unknown as { s: string; n: string | number }[]).map((r) => [r.s, Number(r.n)]));
}

/** KbPageRepository.findSubjectIdsWithPages(ids, [PUBLISHED]). */
export async function subjectsWithPublishedPages(db: Db, ids: string[]): Promise<Set<string>> {
  const rows = await db.execute<{ s: string }>(sql`
    SELECT DISTINCT p.subject_id AS s FROM wiki.kb_page p WHERE p.subject_id IN (${list(ids)}) AND p.status IN ('PUBLISHED')`);
  return new Set((rows as unknown as { s: string }[]).map((r) => r.s));
}
