// repository/proposal/{ProposalRepository, ProposalAttachmentRepository,
// ProposalVoteRepository, ProposalCommentRepository, ProposalAliasRepository}.
// Rows never leave the service layer. Hibernate writes happen where the Java
// entity is flushed; @CreationTimestamp/@UpdateTimestamp are set by the caller.

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { proposal, proposalAlias, proposalAttachment, proposalComment, proposalVote } from '../../db/schema/proposals';
import { pageOffset, type PageRequest } from '../news/paging';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type ProposalRow = typeof proposal.$inferSelect;
export type CommentRow = typeof proposalComment.$inferSelect;
export type AttachmentRow = typeof proposalAttachment.$inferSelect;
export type VoteRow = typeof proposalVote.$inferSelect;
export type AliasRow = typeof proposalAlias.$inferSelect;

// --- ProposalRepository ------------------------------------------------------

export async function findProposal(db: Db, id: string): Promise<ProposalRow | null> {
  const [row] = await db.select().from(proposal).where(eq(proposal.id, id)).limit(1);
  return row ?? null;
}

/** findForUpdate: @Lock(PESSIMISTIC_WRITE) -> SELECT ... FOR UPDATE. */
export async function findProposalForUpdate(db: Db, id: string): Promise<ProposalRow | null> {
  const [row] = await db.select().from(proposal).where(eq(proposal.id, id)).for('update');
  return row ?? null;
}

type ProposalFilter = { status: string; topic?: string } | { authorId: string };

function proposalWhere(f: ProposalFilter) {
  if ('authorId' in f) return eq(proposal.authorId, f.authorId);
  return f.topic === undefined ? eq(proposal.status, f.status) : and(eq(proposal.status, f.status), eq(proposal.topic, f.topic));
}

/**
 * findByStatus[AndTopic]OrderByCreatedAt{Desc,Asc}IdDesc / findByAuthorIdOrderByCreatedAtDescIdDesc
 * with a Pageable: the page, plus the count query.
 */
export async function pageProposals(db: Db, f: ProposalFilter, dir: 'asc' | 'desc', p: PageRequest): Promise<{ rows: ProposalRow[]; total: number }> {
  const where = proposalWhere(f);
  const order = dir === 'desc' ? [desc(proposal.createdAt), desc(proposal.id)] : [asc(proposal.createdAt), asc(proposal.id)];
  const rows = await db.select().from(proposal).where(where).orderBy(...order).limit(p.size).offset(pageOffset(p));
  return { rows, total: await countWhen(rows.length, p, async () => {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(proposal).where(where);
    return Number(r?.n ?? 0);
  }) };
}

/** PageableExecutionUtils.getPage: the count query only runs when the page does not tell the total. */
async function countWhen(contentSize: number, p: PageRequest, count: () => Promise<number>): Promise<number> {
  const offset = pageOffset(p);
  if (offset === 0 && contentSize < p.size) return contentSize;
  if (contentSize !== 0 && contentSize < p.size) return offset + contentSize;
  return count();
}

export interface NewProposal {
  id: string;
  authorId: string;
  title: string;
  description: string;
  topic: string;
  now: Micros;
}

/** saveAndFlush(new Proposal(...)): Hibernate inserts every column. */
export async function insertProposal(db: Db, p: NewProposal): Promise<ProposalRow> {
  const ts = toPgTimestamp(p.now);
  const [row] = await db.insert(proposal).values({
    id: p.id, authorId: p.authorId, title: p.title, description: p.description, topic: p.topic,
    status: 'PENDING', lifecycle: 'ABIERTO', rejectionReason: null, moderatedBy: null, moderatedAt: null,
    createdAt: ts, updatedAt: ts, upCount: 0, downCount: 0, commentCount: 0,
  }).returning();
  return row!;
}

/** The dirty-checking UPDATE of a Proposal (every updatable column, @UpdateTimestamp). */
export async function updateProposal(db: Db, p: {
  id: string; status: string; lifecycle: string; rejectionReason: string | null; moderatedBy: string | null;
  moderatedAt: Micros | null; upCount: number; downCount: number; commentCount: number;
}, updatedAt: Micros): Promise<void> {
  await db.update(proposal).set({
    status: p.status, lifecycle: p.lifecycle, rejectionReason: p.rejectionReason, moderatedBy: p.moderatedBy,
    moderatedAt: p.moderatedAt === null ? null : toPgTimestamp(p.moderatedAt),
    upCount: p.upCount, downCount: p.downCount, commentCount: p.commentCount, updatedAt: toPgTimestamp(updatedAt),
  }).where(eq(proposal.id, p.id));
}

// --- ProposalAttachmentRepository --------------------------------------------

export function findAttachments(db: Db, proposalIds: string[]): Promise<AttachmentRow[]> {
  return db.select().from(proposalAttachment).where(inArray(proposalAttachment.proposalId, proposalIds)).orderBy(asc(proposalAttachment.position));
}

export async function attachmentKeyExists(db: Db, keys: string[]): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(proposalAttachment).where(inArray(proposalAttachment.objectKey, keys));
  return Number(r?.n ?? 0) > 0;
}

export async function insertAttachment(db: Db, a: AttachmentRow): Promise<void> {
  await db.insert(proposalAttachment).values(a);
}

// --- ProposalVoteRepository --------------------------------------------------

export async function findVote(db: Db, proposalId: string, userId: string): Promise<VoteRow | null> {
  const [row] = await db.select().from(proposalVote).where(and(eq(proposalVote.proposalId, proposalId), eq(proposalVote.userId, userId))).limit(1);
  return row ?? null;
}

export function findVotesOf(db: Db, userId: string, proposalIds: string[]): Promise<VoteRow[]> {
  return db.select().from(proposalVote).where(and(eq(proposalVote.userId, userId), inArray(proposalVote.proposalId, proposalIds)));
}

export async function insertVote(db: Db, proposalId: string, userId: string, value: string, now: Micros): Promise<void> {
  const ts = toPgTimestamp(now);
  await db.insert(proposalVote).values({ proposalId, userId, value, createdAt: ts, updatedAt: ts });
}

export async function updateVote(db: Db, proposalId: string, userId: string, value: string, now: Micros): Promise<void> {
  await db.update(proposalVote).set({ value, updatedAt: toPgTimestamp(now) })
    .where(and(eq(proposalVote.proposalId, proposalId), eq(proposalVote.userId, userId)));
}

export async function deleteVote(db: Db, proposalId: string, userId: string): Promise<void> {
  await db.delete(proposalVote).where(and(eq(proposalVote.proposalId, proposalId), eq(proposalVote.userId, userId)));
}

// --- ProposalCommentRepository -----------------------------------------------

/** A top-level comment is listed while live, or as a tombstone while it has live replies. */
function threadWhere(proposalId: string) {
  return sql`${proposalComment.proposalId} = ${proposalId} and ${proposalComment.parentId} is null
    and (${proposalComment.deletedAt} is null or exists (
      select 1 from public.proposal_comment r where r.parent_id = ${proposalComment.id} and r.deleted_at is null))`;
}

/** findThreads: newest first (created_at desc, id desc), with its count query. */
export async function pageThreads(db: Db, proposalId: string, p: PageRequest): Promise<{ rows: CommentRow[]; total: number }> {
  const rows = await db.select().from(proposalComment).where(threadWhere(proposalId))
    .orderBy(desc(proposalComment.createdAt), desc(proposalComment.id)).limit(p.size).offset(pageOffset(p));
  return { rows, total: await countWhen(rows.length, p, async () => {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(proposalComment).where(threadWhere(proposalId));
    return Number(r?.n ?? 0);
  }) };
}

/** findByParentIdInAndDeletedAtIsNullOrderByCreatedAtAscIdAsc */
export function findLiveReplies(db: Db, parentIds: string[]): Promise<CommentRow[]> {
  return db.select().from(proposalComment).where(and(inArray(proposalComment.parentId, parentIds), isNull(proposalComment.deletedAt)))
    .orderBy(asc(proposalComment.createdAt), asc(proposalComment.id));
}

/** findByIdAndProposalId */
export async function findComment(db: Db, id: string, proposalId: string): Promise<CommentRow | null> {
  const [row] = await db.select().from(proposalComment).where(and(eq(proposalComment.id, id), eq(proposalComment.proposalId, proposalId))).limit(1);
  return row ?? null;
}

export async function insertComment(db: Db, c: { id: string; proposalId: string; authorId: string; parentId: string | null; body: string; now: Micros }): Promise<void> {
  await db.insert(proposalComment).values({
    id: c.id, proposalId: c.proposalId, authorId: c.authorId, parentId: c.parentId, body: c.body, createdAt: toPgTimestamp(c.now), deletedAt: null,
  });
}

/** softDelete: deleted_at set, body cleared. */
export async function softDeleteComment(db: Db, id: string, at: Micros): Promise<void> {
  await db.update(proposalComment).set({ deletedAt: toPgTimestamp(at), body: null }).where(eq(proposalComment.id, id));
}

// --- ProposalAliasRepository -------------------------------------------------

export async function findAlias(db: Db, proposalId: string, userId: string): Promise<string | null> {
  const [row] = await db.select({ alias: proposalAlias.alias }).from(proposalAlias)
    .where(and(eq(proposalAlias.proposalId, proposalId), eq(proposalAlias.userId, userId))).limit(1);
  return row?.alias ?? null;
}

/** findAliasesByProposalId */
export async function aliasesOf(db: Db, proposalId: string): Promise<Set<string>> {
  const rows = await db.select({ alias: proposalAlias.alias }).from(proposalAlias).where(eq(proposalAlias.proposalId, proposalId));
  return new Set(rows.map((r) => r.alias));
}

export async function insertAlias(db: Db, proposalId: string, userId: string, alias: string, now: Micros): Promise<void> {
  await db.insert(proposalAlias).values({ proposalId, userId, alias, createdAt: toPgTimestamp(now) });
}

/** findByProposalIdAndUserIdIn */
export function aliasesFor(db: Db, proposalId: string, userIds: string[]): Promise<{ userId: string; alias: string }[]> {
  return db.select({ userId: proposalAlias.userId, alias: proposalAlias.alias }).from(proposalAlias)
    .where(and(eq(proposalAlias.proposalId, proposalId), inArray(proposalAlias.userId, userIds)));
}

/** findAuthorAliases: the alias of each proposal's own author. */
export function authorAliases(db: Db, proposalIds: string[]): Promise<{ proposalId: string; alias: string }[]> {
  return db.select({ proposalId: proposalAlias.proposalId, alias: proposalAlias.alias }).from(proposalAlias)
    .innerJoin(proposal, and(eq(proposal.id, proposalAlias.proposalId), eq(proposalAlias.userId, proposal.authorId)))
    .where(inArray(proposal.id, proposalIds));
}
