// repository/StudyGroupRepository + StudyGroupParticipantRepository (+ the
// SubjectRepository / UserRepository reads the service batches).

import { and, asc, count, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { subject } from '../../db/schema/academic';
import { user } from '../../db/schema/identity';
import { studyGroupParticipants as participants, studyGroups as groups } from '../../db/schema/schedules';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type GroupRow = typeof groups.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;

export interface GroupFilter {
  subjectId: string | null;
  type: string | null;
  /** due_at > now */
  upcomingAfter: Micros | null;
  memberId: string | null;
}

function where(f: GroupFilter): SQL | undefined {
  const w: SQL[] = [];
  if (f.subjectId !== null) w.push(eq(groups.subjectId, f.subjectId));
  if (f.type !== null) w.push(eq(groups.type, f.type));
  if (f.upcomingAfter !== null) w.push(gt(groups.dueAt, toPgTimestamp(f.upcomingAfter)));
  if (f.memberId !== null) {
    w.push(inArray(groups.id, sql`(SELECT p.group_id FROM public.study_group_participants p WHERE p.user_id = ${f.memberId})`));
  }
  return w.length ? and(...w) : undefined;
}

/** groups.findAll(spec, PageRequest.of(page, size, Sort(dueAt asc, id asc))) */
export async function findPage(db: Db, f: GroupFilter, offset: number, size: number): Promise<{ rows: GroupRow[]; total: number }> {
  const rows = await db.select().from(groups).where(where(f)).orderBy(asc(groups.dueAt), asc(groups.id)).limit(size).offset(offset);
  const [c] = await db.select({ n: count() }).from(groups).where(where(f));
  return { rows, total: Number(c?.n ?? 0) };
}

/** groups.findAll(spec, Sort(dueAt asc, id asc)) */
export function findAll(db: Db, f: GroupFilter): Promise<GroupRow[]> {
  return db.select().from(groups).where(where(f)).orderBy(asc(groups.dueAt), asc(groups.id));
}

export async function findById(db: Db, id: string): Promise<GroupRow | null> {
  const [r] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return r ?? null;
}

/** findByIdForUpdate: SELECT ... FOR UPDATE (PESSIMISTIC_WRITE). */
export async function findByIdForUpdate(db: Db, id: string): Promise<GroupRow | null> {
  const [r] = await db.select().from(groups).where(eq(groups.id, id)).for('update');
  return r ?? null;
}

export interface NewGroup {
  ownerId: string; title: string; subjectId: string; type: string; locations: string[]; dueAt: Micros;
  description: string | null; contactLink: string | null; maxParticipants: number | null;
}

export async function insertGroup(db: Db, g: NewGroup, createdAt: Micros, updatedAt: Micros): Promise<GroupRow> {
  const [r] = await db.insert(groups).values({
    id: crypto.randomUUID(), ownerId: g.ownerId, title: g.title, subjectId: g.subjectId, type: g.type, locations: g.locations,
    dueAt: toPgTimestamp(g.dueAt), description: g.description, contactLink: g.contactLink, maxParticipants: g.maxParticipants,
    createdAt: toPgTimestamp(createdAt), updatedAt: toPgTimestamp(updatedAt),
  }).returning();
  return r!;
}

export async function updateGroup(db: Db, id: string, g: Omit<NewGroup, 'ownerId'>, updatedAt: Micros): Promise<void> {
  await db.update(groups).set({
    title: g.title, subjectId: g.subjectId, type: g.type, locations: g.locations, dueAt: toPgTimestamp(g.dueAt),
    description: g.description, contactLink: g.contactLink, maxParticipants: g.maxParticipants, updatedAt: toPgTimestamp(updatedAt),
  }).where(eq(groups.id, id));
}

/** The ownership transfer of leave(): an UPDATE with @UpdateTimestamp. */
export async function setOwner(db: Db, id: string, ownerId: string, updatedAt: Micros): Promise<void> {
  await db.update(groups).set({ ownerId, updatedAt: toPgTimestamp(updatedAt) }).where(eq(groups.id, id));
}

export async function deleteGroup(db: Db, id: string): Promise<void> {
  await db.delete(groups).where(eq(groups.id, id));
}

export async function countMembers(db: Db, groupId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(participants).where(eq(participants.groupId, groupId));
  return Number(r?.n ?? 0);
}

export async function isMember(db: Db, groupId: string, userId: string): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(participants).where(and(eq(participants.groupId, groupId), eq(participants.userId, userId)));
  return Number(r?.n ?? 0) > 0;
}

/** findByGroupIdOrderByJoinedAtAscUserIdAsc */
export function members(db: Db, groupId: string): Promise<ParticipantRow[]> {
  return db.select().from(participants).where(eq(participants.groupId, groupId)).orderBy(asc(participants.joinedAt), asc(participants.userId));
}

export async function insertMember(db: Db, groupId: string, userId: string, joinedAt: Micros): Promise<void> {
  await db.insert(participants).values({ groupId, userId, joinedAt: toPgTimestamp(joinedAt) });
}

export async function deleteMember(db: Db, groupId: string, userId: string): Promise<void> {
  await db.delete(participants).where(and(eq(participants.groupId, groupId), eq(participants.userId, userId)));
}

/** countByGroupIds: [groupId, count] */
export async function memberCounts(db: Db, groupIds: string[]): Promise<Map<string, number>> {
  if (!groupIds.length) return new Map();
  const rows = await db.select({ g: participants.groupId, n: count() }).from(participants)
    .where(inArray(participants.groupId, groupIds)).groupBy(participants.groupId);
  return new Map(rows.map((r) => [r.g, Number(r.n)]));
}

/** findJoinedGroupIds */
export async function joinedGroupIds(db: Db, userId: string, groupIds: string[]): Promise<Set<string>> {
  if (!groupIds.length) return new Set();
  const rows = await db.select({ g: participants.groupId }).from(participants)
    .where(and(eq(participants.userId, userId), inArray(participants.groupId, groupIds)));
  return new Set(rows.map((r) => r.g));
}

export async function subjectExists(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(subject).where(eq(subject.id, id));
  return Number(r?.n ?? 0) > 0;
}

export async function subjectNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function usersByIds(db: Db, ids: string[]): Promise<Map<string, { name: string | null; avatarUrl: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: user.id, name: user.name, avatarUrl: user.avatarUrl }).from(user).where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, avatarUrl: r.avatarUrl }]));
}
