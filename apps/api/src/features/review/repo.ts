// Subject reviews (V64): reviews, their professors, "Me sirvió" votes and reports.

import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { subject } from '../../db/schema/academic';
import {
  professor, subjectReview as reviews, subjectReviewHelpful as helpful, subjectReviewProfessor as reviewProfessors,
  subjectReviewReport as reports,
} from '../../db/schema/reviews';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type ReviewRow = typeof reviews.$inferSelect;
export type ProfessorRow = typeof professor.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;

export async function subjectName(db: Db, id: string): Promise<string | null> {
  const [r] = await db.select({ name: subject.name }).from(subject).where(eq(subject.id, id)).limit(1);
  return r?.name ?? null;
}

export async function subjectNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** A subject's visible reviews plus the viewer's own (even hidden), newest term first. */
export function forSubject(db: Db, subjectId: string, viewerId: string): Promise<ReviewRow[]> {
  return db.select().from(reviews)
    .where(and(eq(reviews.subjectId, subjectId), or(eq(reviews.hidden, false), eq(reviews.userId, viewerId))))
    .orderBy(desc(reviews.year), desc(reviews.period), desc(reviews.createdAt), asc(reviews.id));
}

export async function findById(db: Db, id: string): Promise<ReviewRow | null> {
  const [r] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return r ?? null;
}

export async function findByIdForUpdate(db: Db, id: string): Promise<ReviewRow | null> {
  const [r] = await db.select().from(reviews).where(eq(reviews.id, id)).for('update');
  return r ?? null;
}

export interface ReviewValues {
  year: number; period: number; commission: string; recommend: boolean; difficulty: number; comment: string | null;
}

export async function insertReview(db: Db, id: string, subjectId: string, userId: string, v: ReviewValues, now: Micros): Promise<void> {
  await db.insert(reviews).values({
    id, subjectId, userId, ...v, reportCount: 0, hidden: false, hiddenAt: null, createdAt: toPgTimestamp(now), updatedAt: toPgTimestamp(now),
  });
}

export async function updateReview(db: Db, id: string, v: ReviewValues, now: Micros): Promise<void> {
  await db.update(reviews).set({ ...v, updatedAt: toPgTimestamp(now) }).where(eq(reviews.id, id));
}

export async function deleteReview(db: Db, id: string): Promise<void> {
  await db.delete(reviews).where(eq(reviews.id, id));
}

export async function setProfessors(db: Db, reviewId: string, professorIds: string[]): Promise<void> {
  await db.delete(reviewProfessors).where(eq(reviewProfessors.reviewId, reviewId));
  if (professorIds.length) await db.insert(reviewProfessors).values(professorIds.map((professorId) => ({ reviewId, professorId })));
}

/** reviewId -> professor ids, in name order. */
export async function professorIdsOf(db: Db, reviewIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!reviewIds.length) return out;
  const rows = await db.select({ r: reviewProfessors.reviewId, p: reviewProfessors.professorId }).from(reviewProfessors)
    .innerJoin(professor, eq(professor.id, reviewProfessors.professorId))
    .where(inArray(reviewProfessors.reviewId, reviewIds)).orderBy(asc(professor.name), asc(professor.id));
  for (const row of rows) out.set(row.r, [...(out.get(row.r) ?? []), row.p]);
  return out;
}

export function professorsByIds(db: Db, ids: string[]): Promise<ProfessorRow[]> {
  if (!ids.length) return Promise.resolve([]);
  return db.select().from(professor).where(inArray(professor.id, ids)).orderBy(asc(professor.name), asc(professor.id));
}

export async function professorByEmail(db: Db, email: string): Promise<ProfessorRow | null> {
  const [r] = await db.select().from(professor).where(eq(professor.email, email)).limit(1);
  return r ?? null;
}

/** Inserts the professor, or returns the row another request inserted first. */
export async function upsertProfessor(db: Db, email: string, name: string, now: Micros): Promise<ProfessorRow> {
  await db.insert(professor).values({ id: crypto.randomUUID(), email, name, createdAt: toPgTimestamp(now), updatedAt: toPgTimestamp(now) })
    .onConflictDoNothing({ target: professor.email });
  return (await professorByEmail(db, email))!;
}

/** reviewId -> "Me sirvió" count. */
export async function helpfulCounts(db: Db, reviewIds: string[]): Promise<Map<string, number>> {
  if (!reviewIds.length) return new Map();
  const rows = await db.select({ r: helpful.reviewId, n: count() }).from(helpful).where(inArray(helpful.reviewId, reviewIds)).groupBy(helpful.reviewId);
  return new Map(rows.map((r) => [r.r, Number(r.n)]));
}

export async function helpfulBy(db: Db, userId: string, reviewIds: string[]): Promise<Set<string>> {
  if (!reviewIds.length) return new Set();
  const rows = await db.select({ r: helpful.reviewId }).from(helpful).where(and(eq(helpful.userId, userId), inArray(helpful.reviewId, reviewIds)));
  return new Set(rows.map((r) => r.r));
}

export async function addHelpful(db: Db, reviewId: string, userId: string, now: Micros): Promise<void> {
  await db.insert(helpful).values({ reviewId, userId, createdAt: toPgTimestamp(now) }).onConflictDoNothing();
}

export async function removeHelpful(db: Db, reviewId: string, userId: string): Promise<void> {
  await db.delete(helpful).where(and(eq(helpful.reviewId, reviewId), eq(helpful.userId, userId)));
}

export async function reportedBy(db: Db, userId: string, reviewIds: string[]): Promise<Set<string>> {
  if (!reviewIds.length) return new Set();
  const rows = await db.select({ r: reports.reviewId }).from(reports).where(and(eq(reports.userId, userId), inArray(reports.reviewId, reviewIds)));
  return new Set(rows.map((r) => r.r));
}

/** One report per user: a second one replaces the first. */
export async function upsertReport(db: Db, reviewId: string, userId: string, reason: string, comment: string | null, now: Micros): Promise<void> {
  await db.insert(reports).values({ reviewId, userId, reason, comment, createdAt: toPgTimestamp(now) })
    .onConflictDoUpdate({ target: [reports.reviewId, reports.userId], set: { reason, comment, createdAt: toPgTimestamp(now) } });
}

/**
 * Recounts report_count from the report rows and hides the review at `hideAt`
 * (hidden_at = when; updated_at stays the author's last edit).
 */
export async function recountReports(db: Db, reviewId: string, hideAt: number, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.subject_review r
       SET report_count = c.n,
           hidden = r.hidden OR c.n >= ${hideAt},
           hidden_at = CASE WHEN NOT r.hidden AND c.n >= ${hideAt} THEN ${toPgTimestamp(now)}::timestamptz ELSE r.hidden_at END
      FROM (SELECT count(*)::int AS n FROM public.subject_review_report WHERE review_id = ${reviewId}) c
     WHERE r.id = ${reviewId}`);
}

/** Staff restore: shown again, reports cleared. */
export async function restore(db: Db, reviewId: string): Promise<void> {
  await db.delete(reports).where(eq(reports.reviewId, reviewId));
  await db.update(reviews).set({ hidden: false, hiddenAt: null, reportCount: 0 }).where(eq(reviews.id, reviewId));
}

/** Staff queue: hidden reviews, most recently hidden first. */
export function hidden(db: Db): Promise<ReviewRow[]> {
  return db.select().from(reviews).where(eq(reviews.hidden, true)).orderBy(sql`${reviews.hiddenAt} DESC NULLS LAST`, asc(reviews.id));
}

export async function reportsOf(db: Db, reviewIds: string[]): Promise<Map<string, ReportRow[]>> {
  const out = new Map<string, ReportRow[]>();
  if (!reviewIds.length) return out;
  const rows = await db.select().from(reports).where(inArray(reports.reviewId, reviewIds)).orderBy(asc(reports.createdAt), asc(reports.userId));
  for (const row of rows) out.set(row.reviewId, [...(out.get(row.reviewId) ?? []), row]);
  return out;
}

/**
 * Account deletion (user/accountDeletion.ts): the user's reviews (with their
 * links, votes and reports), "Me sirvió" votes and reports, on both the delete
 * and the anonymize path. Reports are recounted where this user's report counted.
 */
export async function deleteUserData(db: Db, userId: string): Promise<void> {
  await db.execute(sql`
    UPDATE public.subject_review r SET report_count = greatest(r.report_count - 1, 0)
     WHERE r.id IN (SELECT x.review_id FROM public.subject_review_report x WHERE x.user_id = ${userId})`);
  await db.delete(reports).where(eq(reports.userId, userId));
  await db.delete(helpful).where(eq(helpful.userId, userId));
  await db.delete(reviews).where(eq(reviews.userId, userId));
}
