// service/proposal/{ProposalService, ProposalModerationService,
// ProposalAliasService, ProposalViews}.
//
// Visibility: APPROVED proposals are public to every signed-in user; a
// PENDING or REJECTED one only to its author and moderators, 404 to everyone
// else. Votes and comments need an APPROVED proposal whose lifecycle is not
// CERRADO (409). Counters change in the same transaction as the vote/comment
// row, under a row lock on the proposal (SELECT ... FOR UPDATE). Creating and
// commenting are per-user quotas taken once the request is otherwise valid.
//
// Timestamps: a value read from the database prints `...Z`; one set in memory
// prints the zone it was made in: @CreationTimestamp (the JVM zone) for a
// new proposal/comment, OffsetDateTime.now(clock) (ART) for moderatedAt.

import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import { InvalidStateError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, type Micros } from '../../lib/time';
import { javaTrim } from '../../lib/javaCompat';
import { ContentHmac } from '../crypto/logic/contentHmac';
import { MediaUploadService } from '../media/logic/mediaUploadService';
import { firePushes, type PushTrigger } from '../news/pushTriggers';
import { pageResponse, type PageRequest, type PageResponse } from '../news/paging';
import type {
  CreateProposalCommentRequest, CreateProposalRequest, ProposalAttachmentResponse, ProposalCommentResponse,
  ProposalLifecycle, ProposalResponse, ProposalStatus, ProposalTopic, ProposalVoteResponse, ProposalVoteValue,
} from './dto';
import { publishStatusChanged, statusPushTrigger, type ProposalStatusChangedEvent } from './events';
import { ProposalAliasGenerator } from './logic/proposalAliasGenerator';
import * as repo from './repo';

export const MAX_PAGE_SIZE = 50;
export const CREATE_RATE_RULE = 'proposals';
export const COMMENT_RATE_RULE = 'proposal-comments';

/** ProposalService.clampLimit */
export const clampLimit = (limit: number): number => Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
/** ProposalService.pageable: 1-based page, limit clamped to [1, 50]. */
export const pageable = (page: number, limit: number): PageRequest => ({ page: Math.max(page, 1) - 1, size: clampLimit(limit) });

/** The in-memory Proposal entity, with each timestamp pre-formatted for its origin. */
interface ProposalState {
  id: string;
  authorId: string | null;
  title: string;
  description: string;
  topic: ProposalTopic;
  status: ProposalStatus;
  lifecycle: ProposalLifecycle;
  rejectionReason: string | null;
  moderatedBy: string | null;
  moderatedAtUs: Micros | null;
  moderatedAt: string | null;
  createdAt: string;
  upCount: number;
  downCount: number;
  commentCount: number;
}

const fromDb = (pg: string) => formatOffsetDateTime(parsePgTimestamp(pg));

function stateOf(r: repo.ProposalRow): ProposalState {
  return {
    id: r.id, authorId: r.authorId, title: r.title, description: r.description, topic: r.topic as ProposalTopic,
    status: r.status as ProposalStatus, lifecycle: r.lifecycle as ProposalLifecycle, rejectionReason: r.rejectionReason,
    moderatedBy: r.moderatedBy, moderatedAtUs: r.moderatedAt === null ? null : parsePgTimestamp(r.moderatedAt),
    moderatedAt: r.moderatedAt === null ? null : fromDb(r.moderatedAt), createdAt: fromDb(r.createdAt),
    upCount: r.upCount, downCount: r.downCount, commentCount: r.commentCount,
  };
}

const isAuthoredBy = (p: ProposalState, userId: string | null | undefined) => p.authorId !== null && p.authorId === userId;

/** Hibernate's dirty flush of the proposal row (@UpdateTimestamp = VM time). */
function flush(tx: Tx, p: ProposalState): Promise<void> {
  return repo.updateProposal(tx, { ...p, moderatedAt: p.moderatedAtUs }, systemNowMicros());
}

/** ProposalService.visible: approved, or the caller is a moderator or the author; 404 otherwise. */
function visible(found: repo.ProposalRow | null, id: string, viewerId: string | null, moderator: boolean): ProposalState {
  if (found && (found.status === 'APPROVED' || moderator || (found.authorId !== null && found.authorId === viewerId))) return stateOf(found);
  throw new ResourceNotFoundError('Proposal', id);
}

export interface ProposalServiceOptions {
  /** ProposalAliasGenerator (SecureRandom over the bundled words by default). */
  aliasGenerator?: ProposalAliasGenerator;
  /** UserRateLimiter.consume. */
  consume?: (rule: string, userId: string) => void;
  media?: MediaUploadService;
}

/** The MediaUploadService bean: storage + UserRateLimiter + ContentHmac(auth, content.hmac-secret). */
export function mediaUploads(deps: Deps): MediaUploadService {
  return new MediaUploadService(deps.storage, (rule, uid) => deps.userRateLimiter.consume(rule, uid),
    new ContentHmac(deps.config.auth.jwt.secret, deps.config.auth.contentHmacSecret));
}

/** ProposalAliasService + ProposalViews: shared by both services. */
class ProposalSupport {
  constructor(private readonly deps: Deps, private readonly aliasGenerator: ProposalAliasGenerator, readonly media: MediaUploadService) {}

  /** aliasFor (Propagation.MANDATORY): the caller holds the proposal row lock. */
  async aliasFor(tx: Tx, proposalId: string, userId: string): Promise<string> {
    const existing = await repo.findAlias(tx, proposalId, userId);
    if (existing !== null) return existing;
    const alias = this.aliasGenerator.next(await repo.aliasesOf(tx, proposalId));
    await repo.insertAlias(tx, proposalId, userId, alias, systemNowMicros());
    return alias;
  }

  async one(tx: Tx, p: ProposalState, viewerId: string | null, moderator: boolean): Promise<ProposalResponse> {
    return (await this.many(tx, [p], viewerId, moderator))[0]!;
  }

  /** ProposalViews.many: a fixed number of queries per batch. */
  async many(tx: Tx, proposals: ProposalState[], viewerId: string | null, moderator: boolean): Promise<ProposalResponse[]> {
    if (proposals.length === 0) return [];
    const ids = proposals.map((p) => p.id);
    const files = new Map<string, ProposalAttachmentResponse[]>();
    for (const a of await repo.findAttachments(tx, ids)) {
      const list = files.get(a.proposalId) ?? [];
      list.push({ position: a.position, url: this.media.publicUrl(a.objectKey), contentType: a.contentType });
      files.set(a.proposalId, list);
    }
    const myVotes = new Map<string, ProposalVoteValue>();
    if (viewerId !== null) for (const v of await repo.findVotesOf(tx, viewerId, ids)) myVotes.set(v.proposalId, v.value as ProposalVoteValue);
    const authorAliases = new Map<string, string>();
    for (const a of await repo.authorAliases(tx, ids)) authorAliases.set(a.proposalId, a.alias);

    return proposals.map((p) => {
      const mine = isAuthoredBy(p, viewerId);
      return {
        id: p.id, title: p.title, description: p.description, topic: p.topic, status: p.status, lifecycle: p.lifecycle,
        rejectionReason: mine || moderator ? p.rejectionReason : null,
        attachments: files.get(p.id) ?? [],
        upCount: p.upCount, downCount: p.downCount, commentCount: p.commentCount,
        myVote: myVotes.get(p.id) ?? null,
        isMine: mine,
        authorAlias: authorAliases.get(p.id) ?? null,
        createdAt: p.createdAt, moderatedAt: p.moderatedAt,
      };
    });
  }

  page<T>(result: { total: number }, data: T[], page: number, limit: number): PageResponse<T> {
    return pageResponse(data, pageable(page, limit), result.total);
  }

  get jvmZone(): string {
    return this.deps.config.server.timeZone;
  }
}

function support(deps: Deps, o: ProposalServiceOptions): ProposalSupport {
  return new ProposalSupport(deps, o.aliasGenerator ?? new ProposalAliasGenerator(), o.media ?? mediaUploads(deps));
}

interface CommentView {
  id: string;
  parentId: string | null;
  authorId: string | null;
  body: string | null;
  deleted: boolean;
  createdAt: string;
}

function commentView(c: repo.CommentRow): CommentView {
  return { id: c.id, parentId: c.parentId, authorId: c.authorId, body: c.body, deleted: c.deletedAt !== null, createdAt: fromDb(c.createdAt) };
}

/** ProposalService.toResponse */
function toResponse(c: CommentView, p: ProposalState, viewerId: string, aliasByUser: Map<string, string>, replies: ProposalCommentResponse[]): ProposalCommentResponse {
  const author = c.authorId;
  const deleted = c.deleted;
  return {
    id: c.id, parentId: c.parentId,
    alias: deleted || author === null ? null : aliasByUser.get(author) ?? null,
    isMine: !deleted && author !== null && author === viewerId,
    isAuthor: !deleted && author !== null && isAuthoredBy(p, author),
    body: deleted ? null : c.body,
    deleted,
    createdAt: c.createdAt,
    replies,
  };
}

export class ProposalService {
  private readonly s: ProposalSupport;
  private readonly consume: (rule: string, userId: string) => void;

  constructor(private readonly deps: Deps, o: ProposalServiceOptions = {}) {
    this.s = support(deps, o);
    this.consume = o.consume ?? ((rule, uid) => deps.userRateLimiter.consume(rule, uid));
  }

  // --- Reads -------------------------------------------------------------

  listApproved(topic: ProposalTopic | null, page: number, limit: number, viewerId: string): Promise<PageResponse<ProposalResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const result = await repo.pageProposals(tx, topic === null ? { status: 'APPROVED' } : { status: 'APPROVED', topic }, 'desc', pageable(page, limit));
      return this.s.page(result, await this.s.many(tx, result.rows.map(stateOf), viewerId, false), page, limit);
    }, { readOnly: true });
  }

  listMine(userId: string, page: number, limit: number): Promise<PageResponse<ProposalResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const result = await repo.pageProposals(tx, { authorId: userId }, 'desc', pageable(page, limit));
      return this.s.page(result, await this.s.many(tx, result.rows.map(stateOf), userId, false), page, limit);
    }, { readOnly: true });
  }

  get(id: string, viewerId: string, moderator: boolean): Promise<ProposalResponse> {
    return withTx(this.deps.db, async (tx) =>
      this.s.one(tx, visible(await repo.findProposal(tx, id), id, viewerId, moderator), viewerId, moderator), { readOnly: true });
  }

  listComments(proposalId: string, viewerId: string, moderator: boolean, page: number, limit: number): Promise<PageResponse<ProposalCommentResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const p = visible(await repo.findProposal(tx, proposalId), proposalId, viewerId, moderator);
      const threads = await repo.pageThreads(tx, p.id, pageable(page, limit));
      const threadIds = threads.rows.map((c) => c.id);
      const replies = new Map<string, CommentView[]>();
      if (threadIds.length > 0) {
        for (const r of await repo.findLiveReplies(tx, threadIds)) {
          const list = replies.get(r.parentId!) ?? [];
          list.push(commentView(r));
          replies.set(r.parentId!, list);
        }
      }
      const authorIds = new Set<string>();
      for (const c of threads.rows) if (c.authorId !== null) authorIds.add(c.authorId);
      for (const list of replies.values()) for (const c of list) if (c.authorId !== null) authorIds.add(c.authorId);
      const aliasByUser = new Map<string, string>();
      if (authorIds.size > 0) for (const a of await repo.aliasesFor(tx, p.id, [...authorIds])) aliasByUser.set(a.userId, a.alias);

      const data = threads.rows.map((c) => toResponse(commentView(c), p, viewerId, aliasByUser,
        (replies.get(c.id) ?? []).map((r) => toResponse(r, p, viewerId, aliasByUser, []))));
      return this.s.page(threads, data, page, limit);
    }, { readOnly: true });
  }

  // --- Writes ------------------------------------------------------------

  create(authorId: string, req: CreateProposalRequest): Promise<ProposalResponse> {
    return withTx(this.deps.db, async (tx) => {
      const keys = (req.attachmentKeys ?? []) as string[]; // @NotBlank elements: never null here
      if (new Set(keys).size !== keys.length) throw new ValidationError('attachmentKeys', keys, 'duplicate keys');
      const contentTypes: string[] = [];
      for (const key of keys) {
        const type = this.s.media.proposalAttachmentContentType(authorId, key);
        if (type === null) throw new ValidationError('attachmentKeys', key, 'not an attachment key signed for this user');
        contentTypes.push(type);
      }
      if (keys.length > 0 && (await repo.attachmentKeyExists(tx, keys))) {
        throw new ValidationError('attachmentKeys', keys, 'attachment already used by another proposal');
      }
      this.consume(CREATE_RATE_RULE, authorId);

      const now = systemNowMicros(); // @CreationTimestamp
      const row = await repo.insertProposal(tx, {
        id: crypto.randomUUID(), authorId, title: javaTrim(req.title!), description: javaTrim(req.description!), topic: req.topic!, now,
      });
      for (let i = 0; i < keys.length; i++) {
        await repo.insertAttachment(tx, { proposalId: row.id, position: i, objectKey: keys[i]!, contentType: contentTypes[i]! });
      }
      // The author's pseudonym is fixed up front so their comments carry the same one.
      await this.s.aliasFor(tx, row.id, authorId);
      const p = stateOf(row);
      p.createdAt = formatOffsetDateTime(now, this.s.jvmZone);
      return this.s.one(tx, p, authorId, false);
    });
  }

  vote(proposalId: string, userId: string, value: ProposalVoteValue): Promise<ProposalVoteResponse> {
    return withTx(this.deps.db, async (tx) => {
      const p = await this.interactive(tx, proposalId, userId);
      const existing = await repo.findVote(tx, proposalId, userId);
      if (existing === null) {
        await repo.insertVote(tx, proposalId, userId, value, systemNowMicros());
        p.upCount += value === 'UP' ? 1 : 0;
        p.downCount += value === 'DOWN' ? 1 : 0;
        await flush(tx, p);
      } else if (existing.value !== value) {
        await repo.updateVote(tx, proposalId, userId, value, systemNowMicros());
        const toUp = value === 'UP' ? 1 : -1;
        p.upCount += toUp;
        p.downCount -= toUp;
        await flush(tx, p);
      }
      return { upCount: p.upCount, downCount: p.downCount, myVote: value };
    });
  }

  /** Idempotent; allowed on closed proposals so users can always take their vote back. */
  removeVote(proposalId: string, userId: string): Promise<ProposalVoteResponse> {
    return withTx(this.deps.db, async (tx) => {
      const p = visible(await repo.findProposalForUpdate(tx, proposalId), proposalId, userId, false);
      const v = await repo.findVote(tx, proposalId, userId);
      if (v !== null) {
        p.upCount -= v.value === 'UP' ? 1 : 0;
        p.downCount -= v.value === 'DOWN' ? 1 : 0;
        await repo.deleteVote(tx, proposalId, userId);
        await flush(tx, p);
      }
      return { upCount: p.upCount, downCount: p.downCount, myVote: null };
    });
  }

  addComment(proposalId: string, userId: string, req: CreateProposalCommentRequest): Promise<ProposalCommentResponse> {
    return withTx(this.deps.db, async (tx) => {
      const p = await this.interactive(tx, proposalId, userId);
      if (req.parentId !== null) {
        const parent = await repo.findComment(tx, req.parentId, proposalId);
        if (parent === null) throw new ValidationError('parentId', req.parentId, 'no such comment on this proposal');
        if (parent.parentId !== null) throw new ValidationError('parentId', req.parentId, 'replies can only answer a top-level comment');
        if (parent.deletedAt !== null) throw new ValidationError('parentId', req.parentId, 'comment was deleted');
      }
      this.consume(COMMENT_RATE_RULE, userId);
      const alias = await this.s.aliasFor(tx, proposalId, userId);
      const now = systemNowMicros(); // @CreationTimestamp
      const id = crypto.randomUUID();
      const body = javaTrim(req.body!);
      await repo.insertComment(tx, { id, proposalId, authorId: userId, parentId: req.parentId, body, now });
      p.commentCount += 1;
      await flush(tx, p);
      const c: CommentView = { id, parentId: req.parentId, authorId: userId, body, deleted: false, createdAt: formatOffsetDateTime(now, this.s.jvmZone) };
      return toResponse(c, p, userId, new Map([[userId, alias]]), []);
    });
  }

  deleteOwnComment(proposalId: string, commentId: string, userId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const p = visible(await repo.findProposalForUpdate(tx, proposalId), proposalId, userId, false);
      const c = await repo.findComment(tx, commentId, proposalId);
      if (c === null || c.deletedAt !== null || c.authorId !== userId) throw new ResourceNotFoundError('ProposalComment', commentId);
      await repo.softDeleteComment(tx, c.id, this.deps.clock.now());
      p.commentCount -= 1;
      await flush(tx, p);
    });
  }

  /** Locked, visible to the user, APPROVED and not CERRADO. */
  private async interactive(tx: Tx, proposalId: string, userId: string): Promise<ProposalState> {
    const p = visible(await repo.findProposalForUpdate(tx, proposalId), proposalId, userId, false);
    if (p.status !== 'APPROVED') throw new InvalidStateError('Proposal is not approved yet');
    if (p.lifecycle === 'CERRADO') throw new InvalidStateError('Proposal is closed');
    return p;
  }
}

/**
 * Moderator actions (ROLE_MODERATOR, enforced by policy.ts). PENDING ->
 * APPROVED | REJECTED, and an APPROVED proposal can be taken down (->
 * REJECTED). The lifecycle is only set on APPROVED proposals. Every change
 * publishes a ProposalStatusChangedEvent; its push is fired after commit.
 */
export class ProposalModerationService {
  private readonly s: ProposalSupport;

  constructor(private readonly deps: Deps, o: ProposalServiceOptions = {}) {
    this.s = support(deps, o);
  }

  /** Queue for a moderation status, oldest first. */
  list(status: ProposalStatus, page: number, limit: number, moderatorId: string): Promise<PageResponse<ProposalResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const result = await repo.pageProposals(tx, { status }, 'asc', pageable(page, limit));
      return this.s.page(result, await this.s.many(tx, result.rows.map(stateOf), moderatorId, true), page, limit);
    }, { readOnly: true });
  }

  approve(proposalId: string, moderatorId: string): Promise<ProposalResponse> {
    return this.moderating(async (tx, triggers) => {
      const p = await this.locked(tx, proposalId);
      if (p.status !== 'PENDING') throw new InvalidStateError(`Proposal is already ${p.status}`);
      this.moderate(p, 'APPROVED', null, moderatorId);
      await flush(tx, p);
      await this.publish(p, 'APPROVED', triggers);
      return this.s.one(tx, p, moderatorId, true);
    });
  }

  reject(proposalId: string, moderatorId: string, reason: string): Promise<ProposalResponse> {
    return this.moderating(async (tx, triggers) => {
      const p = await this.locked(tx, proposalId);
      if (p.status === 'REJECTED') throw new InvalidStateError('Proposal is already REJECTED');
      this.moderate(p, 'REJECTED', javaTrim(reason), moderatorId);
      await flush(tx, p);
      await this.publish(p, 'REJECTED', triggers);
      return this.s.one(tx, p, moderatorId, true);
    });
  }

  setLifecycle(proposalId: string, moderatorId: string, lifecycle: ProposalLifecycle): Promise<ProposalResponse> {
    return this.moderating(async (tx, triggers) => {
      const p = await this.locked(tx, proposalId);
      if (p.status !== 'APPROVED') throw new InvalidStateError('Only approved proposals have a lifecycle');
      if (p.lifecycle !== lifecycle) {
        p.lifecycle = lifecycle;
        await flush(tx, p);
        await this.publish(p, lifecycle, triggers);
      }
      return this.s.one(tx, p, moderatorId, true);
    });
  }

  deleteComment(proposalId: string, commentId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const p = await this.locked(tx, proposalId);
      const c = await repo.findComment(tx, commentId, proposalId);
      if (c === null) throw new ResourceNotFoundError('ProposalComment', commentId);
      if (c.deletedAt === null) {
        await repo.softDeleteComment(tx, c.id, this.deps.clock.now());
        p.commentCount -= 1;
        await flush(tx, p);
      }
    });
  }

  /** @Transactional + pushes delivered only after commit. */
  private async moderating<T>(fn: (tx: Tx, triggers: PushTrigger[]) => Promise<T>): Promise<T> {
    const triggers: PushTrigger[] = [];
    const result = await withTx(this.deps.db, (tx) => fn(tx, triggers));
    firePushes(this.deps, triggers);
    return result;
  }

  /** Proposal.moderate with OffsetDateTime.now(clock). */
  private moderate(p: ProposalState, status: ProposalStatus, reason: string | null, moderatorId: string) {
    const at = this.deps.clock.now();
    p.status = status;
    p.rejectionReason = reason;
    p.moderatedBy = moderatorId;
    p.moderatedAtUs = at;
    p.moderatedAt = formatOffsetDateTime(at, this.deps.clock.zone);
  }

  private async locked(tx: Tx, proposalId: string): Promise<ProposalState> {
    const row = await repo.findProposalForUpdate(tx, proposalId);
    if (!row) throw new ResourceNotFoundError('Proposal', proposalId);
    return stateOf(row);
  }

  /** publishEvent: listeners run now; the notifier's trigger waits for commit. */
  private async publish(p: ProposalState, newStatus: string, triggers: PushTrigger[]) {
    const event: ProposalStatusChangedEvent = { proposalId: p.id, authorId: p.authorId, newStatus };
    publishStatusChanged(event);
    const t = await statusPushTrigger(event, (id) => (id === p.id ? p.title : null));
    if (t) triggers.push(t);
  }
}
