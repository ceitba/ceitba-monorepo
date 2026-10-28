// Comments and polls of newsletter articles (V64). Timestamps are read as text
// (`::text`) and formatted by the services.

import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  articleCommentLikes, articleCommentReports, articleComments, articlePollOptions, articlePolls, articlePollVotes, articles,
} from '../../db/schema/news';

async function rows<T>(db: Db, q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

// ------------------------------------------------------------------ articles

export interface ArticleGateRow {
  id: string;
  status: string;
  organization: string | null;
  createdBy: string | null;
  commentsEnabled: boolean;
}

export async function findArticle(db: Db, id: string, forUpdate = false): Promise<ArticleGateRow | null> {
  const q = db.select({
    id: articles.id, status: articles.status, organization: articles.organization, createdBy: articles.createdBy,
    commentsEnabled: articles.commentsEnabled,
  }).from(articles).where(eq(articles.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

export async function setCommentsEnabled(db: Db, id: string, enabled: boolean): Promise<void> {
  await db.update(articles).set({ commentsEnabled: enabled }).where(eq(articles.id, id));
}

// ------------------------------------------------------------------ comments

export interface CommentViewRow {
  id: string;
  parent_id: string | null;
  user_id: string | null;
  body: string;
  pinned: boolean;
  hidden_at: string | null;
  deleted_at: string | null;
  created_at: string;
  author_name: string | null;
  author_avatar_url: string | null;
  is_author: boolean;
  likes: number;
  liked: boolean;
}

const COMMENT_VIEW = (viewer: string | null) => sql`
  SELECT c.id, c.parent_id, c.user_id, c.body, c.pinned, c.hidden_at::text AS hidden_at, c.deleted_at::text AS deleted_at,
         c.created_at::text AS created_at, u.name AS author_name, u.avatar_url AS author_avatar_url,
         (a.organization IS NOT NULL AND c.user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_organizations m WHERE m.user_id = c.user_id AND m.org_slug = a.organization)) AS is_author,
         (SELECT count(*) FROM public.article_comment_likes l WHERE l.comment_id = c.id)::int AS likes,
         EXISTS (SELECT 1 FROM public.article_comment_likes l WHERE l.comment_id = c.id AND l.user_id = ${viewer}::uuid) AS liked
  FROM public.article_comments c
  JOIN public.articles a ON a.id = c.article_id
  LEFT JOIN public."user" u ON u.id = c.user_id`;

/**
 * Every comment of an article. Top-level comments come pinned first, then by
 * likes (sort `top`) and newest; replies keep their creation order, so grouping
 * them under their parent in row order gives the thread.
 */
export function listComments(db: Db, articleId: string, viewer: string | null, top: boolean): Promise<CommentViewRow[]> {
  return rows(db, sql`${COMMENT_VIEW(viewer)}
    WHERE c.article_id = ${articleId}
    ORDER BY c.pinned DESC,
             CASE WHEN ${top} AND c.parent_id IS NULL THEN (SELECT count(*) FROM public.article_comment_likes l WHERE l.comment_id = c.id) END DESC NULLS LAST,
             CASE WHEN c.parent_id IS NULL THEN c.created_at END DESC NULLS LAST,
             c.created_at ASC, c.id ASC`);
}

export async function findCommentView(db: Db, id: string, viewer: string | null): Promise<CommentViewRow | null> {
  const [row] = await rows<CommentViewRow>(db, sql`${COMMENT_VIEW(viewer)} WHERE c.id = ${id}`);
  return row ?? null;
}

export async function findComment(db: Db, articleId: string, id: string, forUpdate = false) {
  const q = db.select().from(articleComments).where(and(eq(articleComments.id, id), eq(articleComments.articleId, articleId)));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}
export type CommentRow = NonNullable<Awaited<ReturnType<typeof findComment>>>;

export async function insertComment(db: Db, c: { id: string; articleId: string; userId: string; parentId: string | null; body: string; createdAt: string }): Promise<void> {
  await db.insert(articleComments).values({ ...c, pinned: false, hiddenAt: null, deletedAt: null });
}

export async function softDeleteComment(db: Db, id: string, now: string): Promise<void> {
  await db.update(articleComments).set({ deletedAt: now, pinned: false }).where(eq(articleComments.id, id));
}

/** Pins `id` and unpins every other comment of the article (one pin per article). */
export async function pinComment(db: Db, articleId: string, id: string): Promise<void> {
  await db.execute(sql`UPDATE public.article_comments SET pinned = (id = ${id}::uuid)
    WHERE article_id = ${articleId} AND (pinned OR id = ${id}::uuid)`);
}

export async function unpinComment(db: Db, id: string): Promise<void> {
  await db.update(articleComments).set({ pinned: false }).where(eq(articleComments.id, id));
}

export async function setCommentHidden(db: Db, id: string, hiddenAt: string | null): Promise<void> {
  await db.update(articleComments).set({ hiddenAt }).where(eq(articleComments.id, id));
}

export async function likeComment(db: Db, commentId: string, userId: string, now: string): Promise<void> {
  await db.insert(articleCommentLikes).values({ commentId, userId, createdAt: now }).onConflictDoNothing();
}

export async function unlikeComment(db: Db, commentId: string, userId: string): Promise<void> {
  await db.delete(articleCommentLikes).where(and(eq(articleCommentLikes.commentId, commentId), eq(articleCommentLikes.userId, userId)));
}

export async function likeState(db: Db, commentId: string, userId: string): Promise<{ likes: number; liked: boolean }> {
  const [row] = await rows<{ likes: number; liked: boolean }>(db, sql`
    SELECT count(*)::int AS likes, coalesce(bool_or(user_id = ${userId}::uuid), false) AS liked
    FROM public.article_comment_likes WHERE comment_id = ${commentId}::uuid`);
  return row!;
}

/** One report per user: a new one replaces the reason. Returns the comment's report count. */
export async function upsertReport(db: Db, commentId: string, userId: string, reason: string | null, now: string): Promise<number> {
  await db.insert(articleCommentReports).values({ commentId, userId, reason, createdAt: now })
    .onConflictDoUpdate({ target: [articleCommentReports.commentId, articleCommentReports.userId], set: { reason, createdAt: now } });
  const [row] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM public.article_comment_reports WHERE comment_id = ${commentId}::uuid`);
  return row!.n;
}

export async function deleteReports(db: Db, commentId: string): Promise<void> {
  await db.delete(articleCommentReports).where(eq(articleCommentReports.commentId, commentId));
}

// ------------------------------------------------------------------ polls

export async function findPoll(db: Db, articleId: string, id: string, forUpdate = false) {
  const q = db.select().from(articlePolls).where(and(eq(articlePolls.id, id), eq(articlePolls.articleId, articleId)));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}
export type PollRow = NonNullable<Awaited<ReturnType<typeof findPoll>>>;

export function listPolls(db: Db, articleId: string): Promise<PollRow[]> {
  return db.select().from(articlePolls).where(eq(articlePolls.articleId, articleId)).orderBy(asc(articlePolls.createdAt), asc(articlePolls.id));
}

export interface OptionCountRow { id: string; poll_id: string; label: string; votes: number }

/** Options of the given polls in position order, with their vote counts. */
export function optionsWithCounts(db: Db, pollIds: string[]): Promise<OptionCountRow[]> {
  if (pollIds.length === 0) return Promise.resolve([]);
  return rows(db, sql`
    SELECT o.id, o.poll_id, o.label, (SELECT count(*) FROM public.article_poll_votes v WHERE v.option_id = o.id)::int AS votes
    FROM public.article_poll_options o
    WHERE o.poll_id IN (${sql.join(pollIds.map((id) => sql`${id}::uuid`), sql`, `)})
    ORDER BY o.poll_id, o.position`);
}

/** poll id -> the option the user voted. */
export async function votesOf(db: Db, pollIds: string[], userId: string | null): Promise<Map<string, string>> {
  if (pollIds.length === 0 || userId === null) return new Map();
  const found = await rows<{ poll_id: string; option_id: string }>(db, sql`
    SELECT poll_id, option_id FROM public.article_poll_votes
    WHERE user_id = ${userId}::uuid AND poll_id IN (${sql.join(pollIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map(found.map((r) => [r.poll_id, r.option_id]));
}

export async function insertPoll(db: Db, p: { id: string; articleId: string; question: string; resultsVisibility: string; closesAt: string | null; createdAt: string }): Promise<void> {
  await db.insert(articlePolls).values(p);
}

export async function updatePoll(db: Db, id: string, set: { question: string; resultsVisibility: string; closesAt: string | null }): Promise<void> {
  await db.update(articlePolls).set(set).where(eq(articlePolls.id, id));
}

export async function deletePoll(db: Db, id: string): Promise<void> {
  await db.delete(articlePolls).where(eq(articlePolls.id, id));
}

export async function replaceOptions(db: Db, pollId: string, labels: string[]): Promise<void> {
  await db.delete(articlePollOptions).where(eq(articlePollOptions.pollId, pollId));
  await db.insert(articlePollOptions).values(labels.map((label, position) => ({ id: crypto.randomUUID(), pollId, position, label })));
}

export async function optionBelongsTo(db: Db, pollId: string, optionId: string): Promise<boolean> {
  const [row] = await db.select({ id: articlePollOptions.id }).from(articlePollOptions)
    .where(and(eq(articlePollOptions.id, optionId), eq(articlePollOptions.pollId, pollId)));
  return row !== undefined;
}

export async function countVotes(db: Db, pollId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM public.article_poll_votes WHERE poll_id = ${pollId}::uuid`);
  return row!.n;
}

export async function upsertVote(db: Db, pollId: string, userId: string, optionId: string, now: string): Promise<void> {
  await db.insert(articlePollVotes).values({ pollId, userId, optionId, createdAt: now })
    .onConflictDoUpdate({ target: [articlePollVotes.pollId, articlePollVotes.userId], set: { optionId, createdAt: now } });
}

export async function deleteVote(db: Db, pollId: string, userId: string): Promise<void> {
  await db.delete(articlePollVotes).where(and(eq(articlePollVotes.pollId, pollId), eq(articlePollVotes.userId, userId)));
}
