// repository/HomeHighlightRepository (Spring Data JPA -> drizzle).

import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { homeHighlights } from '../../db/schema/news';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type HighlightRow = typeof homeHighlights.$inferSelect;

export interface HighlightValues {
  title: string;
  description: string | null;
  imageUrl: string;
  linkUrl: string | null;
  position: number;
  startsAt: Micros | null;
  endsAt: Micros | null;
  active: boolean;
}

const ts = (us: Micros | null) => (us === null ? null : toPgTimestamp(us));

/** findVisible(now): active and inside the optional [starts_at, ends_at) window. */
export function findVisible(db: Db, now: Micros): Promise<HighlightRow[]> {
  const at = toPgTimestamp(now);
  return db.select().from(homeHighlights)
    .where(and(
      eq(homeHighlights.active, true),
      or(isNull(homeHighlights.startsAt), lte(homeHighlights.startsAt, at)),
      or(isNull(homeHighlights.endsAt), gt(homeHighlights.endsAt, at)),
    ))
    .orderBy(asc(homeHighlights.position), asc(homeHighlights.createdAt));
}

/** findAllByOrderByPositionAscCreatedAtAsc(). */
export function findAllOrdered(db: Db): Promise<HighlightRow[]> {
  return db.select().from(homeHighlights).orderBy(asc(homeHighlights.position), asc(homeHighlights.createdAt));
}

export async function findById(db: Db, id: string): Promise<HighlightRow | null> {
  const [row] = await db.select().from(homeHighlights).where(eq(homeHighlights.id, id)).limit(1);
  return row ?? null;
}

export async function exists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(homeHighlights).where(eq(homeHighlights.id, id));
  return Number(row?.n ?? 0) > 0;
}

/** persist: @CreationTimestamp/@UpdateTimestamp set to `now`; every column written. */
export async function insert(db: Db, id: string, v: HighlightValues, now: Micros): Promise<void> {
  await db.insert(homeHighlights).values({
    id, title: v.title, description: v.description, imageUrl: v.imageUrl, linkUrl: v.linkUrl,
    position: v.position, startsAt: ts(v.startsAt), endsAt: ts(v.endsAt), active: v.active,
    createdAt: toPgTimestamp(now), updatedAt: toPgTimestamp(now),
  });
}

export async function update(db: Db, id: string, v: HighlightValues, now: Micros): Promise<void> {
  await db.update(homeHighlights).set({
    title: v.title, description: v.description, imageUrl: v.imageUrl, linkUrl: v.linkUrl,
    position: v.position, startsAt: ts(v.startsAt), endsAt: ts(v.endsAt), active: v.active,
    updatedAt: toPgTimestamp(now),
  }).where(eq(homeHighlights.id, id));
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(homeHighlights).where(eq(homeHighlights.id, id));
}
