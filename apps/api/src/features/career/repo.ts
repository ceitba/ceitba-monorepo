// repository/CareerRepository + PlanRepository (Spring Data JPA -> drizzle).
// Rows never leave the service layer.

import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { careers, plan } from '../../db/schema/academic';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type CareerRow = typeof careers.$inferSelect;
export type PlanRow = typeof plan.$inferSelect;

/** careerRepository.findAll(Sort.by("id")): ORDER BY id in the database collation. */
export function findAllCareers(db: Db): Promise<CareerRow[]> {
  return db.select().from(careers).orderBy(asc(careers.id));
}

export async function findCareer(db: Db, id: string): Promise<CareerRow | null> {
  const [row] = await db.select().from(careers).where(eq(careers.id, id)).limit(1);
  return row ?? null;
}

export async function careerExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(careers).where(eq(careers.id, id));
  return Number(row?.n ?? 0) > 0;
}

/** INSERT; @UpdateTimestamp sets updated_at on insert too. */
export async function insertCareer(db: Db, id: string, name: string, now: Micros): Promise<CareerRow> {
  const [row] = await db.insert(careers).values({ id, name, updatedAt: toPgTimestamp(now) }).returning();
  return row!;
}

export async function updateCareerName(db: Db, id: string, name: string, now: Micros): Promise<CareerRow> {
  const [row] = await db.update(careers).set({ name, updatedAt: toPgTimestamp(now) }).where(eq(careers.id, id)).returning();
  return row!;
}

export async function deleteCareer(db: Db, id: string): Promise<void> {
  await db.delete(careers).where(eq(careers.id, id));
}

/** planRepository.findAll(Sort.by("id")). */
export function findAllPlans(db: Db): Promise<PlanRow[]> {
  return db.select().from(plan).orderBy(asc(plan.id));
}

export async function planExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(plan).where(eq(plan.id, id));
  return Number(row?.n ?? 0) > 0;
}

export async function insertPlan(db: Db, id: string, careerId: string, name: string | null, now: Micros): Promise<PlanRow> {
  const [row] = await db.insert(plan).values({ id, careerId, name, updatedAt: toPgTimestamp(now) }).returning();
  return row!;
}
