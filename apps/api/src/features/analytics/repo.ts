// The analytics_events / article_votes queries of AnalyticsService (raw SQL: the
// aggregates are the Java @Query strings). `since` is a Postgres timestamp text.

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';

type Row = Record<string, unknown>;
const rows = async (db: Db, q: SQL) => (await db.execute(q)) as unknown as Row[];

export interface NewEvent {
  type: string; sessionId: string; ts: string; articleId: string | null; eventId: string | null;
  category: string | null; path: string | null; ipHash: string;
}

export async function insertEvent(db: Db, e: NewEvent): Promise<void> {
  await db.execute(sql`INSERT INTO public.analytics_events (type, session_id, ts, article_id, event_id, category, path, ip_hash)
    VALUES (${e.type}, ${e.sessionId}, ${e.ts}, ${e.articleId}, ${e.eventId}, ${e.category}, ${e.path}, ${e.ipHash})`);
}

export async function countArticleViewsSince(db: Db, since: string): Promise<number> {
  const [r] = await rows(db, sql`SELECT COUNT(*) AS n FROM public.analytics_events WHERE type = 'article_view' AND ts >= ${since}::timestamptz`);
  return Number(r!.n);
}

export async function countVisitorsSince(db: Db, since: string): Promise<number> {
  const [r] = await rows(db, sql`SELECT COUNT(DISTINCT session_id) AS n FROM public.analytics_events WHERE ts >= ${since}::timestamptz`);
  return Number(r!.n);
}

export async function topArticlesSince(db: Db, since: string): Promise<{ articleId: string; title: string; views: number }[]> {
  return (await rows(db, sql`
    SELECT ae.article_id, a.title, COUNT(*) AS views FROM public.analytics_events ae JOIN public.articles a ON a.id = ae.article_id
    WHERE ae.type = 'article_view' AND ae.ts >= ${since}::timestamptz AND ae.article_id IS NOT NULL
    GROUP BY ae.article_id, a.title ORDER BY views DESC LIMIT 10`))
    .map((r) => ({ articleId: r.article_id as string, title: r.title as string, views: Number(r.views) }));
}

export async function categoryViewsSince(db: Db, since: string): Promise<{ category: string; views: number }[]> {
  return (await rows(db, sql`
    SELECT ae.category, COUNT(*) AS views FROM public.analytics_events ae
    WHERE ae.type = 'category_filter' AND ae.ts >= ${since}::timestamptz AND ae.category IS NOT NULL
    GROUP BY ae.category ORDER BY views DESC`))
    .map((r) => ({ category: r.category as string, views: Number(r.views) }));
}

export async function dailyViewsSince(db: Db, since: string): Promise<{ date: string; views: number }[]> {
  return (await rows(db, sql`
    SELECT date_trunc('day', ts)::date::text AS day, COUNT(*) AS views FROM public.analytics_events
    WHERE type = 'article_view' AND ts >= ${since}::timestamptz GROUP BY 1 ORDER BY 1`))
    .map((r) => ({ date: r.day as string, views: Number(r.views) }));
}

/** voteRepo.findAll() with each article's title (null when the article is gone). */
export async function allVotes(db: Db): Promise<{ articleId: string; title: string | null; up: number; down: number }[]> {
  return (await rows(db, sql`SELECT v.article_id, v.up_count, v.down_count, a.title FROM public.article_votes v
    LEFT JOIN public.articles a ON a.id = v.article_id ORDER BY v.ctid`)) // findAll(): a seq scan, so heap order
    .map((r) => ({ articleId: r.article_id as string, title: r.title as string | null, up: Number(r.up_count), down: Number(r.down_count) }));
}
