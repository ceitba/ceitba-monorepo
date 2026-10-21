// repository/ShareSessionRepository + ShareSessionParticipantRepository and the
// SavedScheduleRepository reads share sessions use.

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { savedSchedules, shareSessionParticipants as participants, shareSessions as sessions } from '../../db/schema/schedules';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type SessionRow = typeof sessions.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
/** A saved schedule with its payload as Postgres jsonb text. */
export interface ScheduleRef { id: string; careerId: string | null; plan: string | null; payloadText: string }

/** savedSchedules.findByIdAndUserId(id, userId): existence is all share needs. */
export async function savedScheduleOwned(db: Db, id: string, userId: string): Promise<boolean> {
  const [r] = await db.select({ id: savedSchedules.id }).from(savedSchedules)
    .where(and(eq(savedSchedules.id, id), eq(savedSchedules.userId, userId))).limit(1);
  return r !== undefined;
}

/** savedSchedules.findAllById(ids) */
export async function schedulesByIds(db: Db, ids: string[]): Promise<Map<string, ScheduleRef>> {
  if (!ids.length) return new Map();
  const rows = await db.select({
    id: savedSchedules.id, careerId: savedSchedules.careerId, plan: savedSchedules.plan,
    payloadText: sql<string>`${savedSchedules.payload}::text`,
  }).from(savedSchedules).where(inArray(savedSchedules.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function tokenExists(db: Db, token: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(sessions).where(eq(sessions.token, token));
  return Number(r?.n ?? 0) > 0;
}

export async function findByToken(db: Db, token: string): Promise<SessionRow | null> {
  const [r] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  return r ?? null;
}

/** save(new ShareSession(token, creator, name)): @CreationTimestamp/@UpdateTimestamp = now, expires_at NULL. */
export async function insertSession(db: Db, token: string, creatorUserId: string, name: string | null, now: Micros): Promise<SessionRow> {
  const ts = toPgTimestamp(now);
  const [r] = await db.insert(sessions).values({ id: crypto.randomUUID(), token, creatorUserId, name, expiresAt: null, createdAt: ts, updatedAt: ts }).returning();
  return r!;
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

/** findBySessionIdOrderByJoinedAtAsc */
export function participantsOf(db: Db, sessionId: string): Promise<ParticipantRow[]> {
  return db.select().from(participants).where(eq(participants.sessionId, sessionId)).orderBy(asc(participants.joinedAt));
}

export async function countParticipants(db: Db, sessionId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(participants).where(eq(participants.sessionId, sessionId));
  return Number(r?.n ?? 0);
}

export async function insertParticipant(db: Db, sessionId: string, userId: string, savedScheduleId: string, displayName: string, joinedAt: Micros): Promise<void> {
  await db.insert(participants).values({ sessionId, userId, savedScheduleId, displayName, joinedAt: toPgTimestamp(joinedAt) });
}

/** The merge of an existing (session, user) row: joined_at is updatable = false. */
export async function updateParticipant(db: Db, sessionId: string, userId: string, savedScheduleId: string, displayName: string): Promise<void> {
  await db.update(participants).set({ savedScheduleId, displayName })
    .where(and(eq(participants.sessionId, sessionId), eq(participants.userId, userId)));
}

export async function deleteParticipant(db: Db, sessionId: string, userId: string): Promise<void> {
  await db.delete(participants).where(and(eq(participants.sessionId, sessionId), eq(participants.userId, userId)));
}
