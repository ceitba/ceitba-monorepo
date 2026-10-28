// Polls embedded in articles (docs/NEWSLETTER-ENGAGEMENT.md "Polls").

import { withTx, type Db } from '../../db/client';
import type { Deps } from '../../deps';
import { AccessDeniedError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaTrim } from '../../lib/javaCompat';
import { parsePgTimestamp, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { CreatePollRequest, PollResponse, PollVoteRequest, ResultsVisibility, UpdatePollRequest } from './dto';
import { REACTION_RATE_RULE, requirePublished } from './comments';
import { EngagementConflictError } from './errors';
import { dbInstant, type ArticleAccess, type ArticleGate, type Viewer } from './gate';
import * as repo from './repo';

export class PollService {
  constructor(private readonly deps: Deps, private readonly gate: ArticleGate) {}

  list(articleId: string, viewer: Viewer): Promise<PollResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      return this.responses(tx, await repo.listPolls(tx, articleId), viewer, access);
    }, { readOnly: true });
  }

  get(articleId: string, pollId: string, viewer: Viewer): Promise<PollResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      return this.response(tx, await this.requirePoll(tx, articleId, pollId), viewer, access);
    }, { readOnly: true });
  }

  create(articleId: string, viewer: Viewer, req: CreatePollRequest): Promise<PollResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.edit(tx, articleId, viewer);
      const id = crypto.randomUUID();
      await repo.insertPoll(tx, {
        id, articleId, question: javaTrim(req.question!), resultsVisibility: req.resultsVisibility ?? 'after_vote',
        closesAt: req.closesAt === null ? null : toPgTimestamp(req.closesAt), createdAt: toPgTimestamp(systemNowMicros()),
      });
      await repo.replaceOptions(tx, id, labels(req.options!));
      return this.response(tx, await this.requirePoll(tx, articleId, id), viewer, access);
    });
  }

  update(articleId: string, pollId: string, viewer: Viewer, req: UpdatePollRequest): Promise<PollResponse> {
    return withTx(this.deps.db, async (tx) => {
      const access = await this.edit(tx, articleId, viewer);
      const poll = await this.requirePoll(tx, articleId, pollId, true);
      if (req.close && req.reopen) throw new ValidationError('reopen', true, 'cannot close and reopen at once');
      let closesAt = poll.closesAt;
      if (req.closesAt !== null) closesAt = toPgTimestamp(req.closesAt);
      if (req.close) closesAt = toPgTimestamp(this.deps.clock.now());
      if (req.reopen) closesAt = null;
      await repo.updatePoll(tx, pollId, {
        question: req.question === null ? poll.question : javaTrim(req.question),
        resultsVisibility: req.resultsVisibility ?? poll.resultsVisibility,
        closesAt,
      });
      if (req.options !== null) {
        if (await repo.countVotes(tx, pollId) > 0) throw new EngagementConflictError('POLL_HAS_VOTES');
        await repo.replaceOptions(tx, pollId, labels(req.options));
      }
      return this.response(tx, await this.requirePoll(tx, articleId, pollId), viewer, access);
    });
  }

  delete(articleId: string, pollId: string, viewer: Viewer): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      await this.edit(tx, articleId, viewer);
      await this.requirePoll(tx, articleId, pollId);
      await repo.deletePoll(tx, pollId);
    });
  }

  vote(articleId: string, pollId: string, viewer: Viewer, req: PollVoteRequest | null): Promise<PollResponse> {
    this.deps.userRateLimiter.consume(REACTION_RATE_RULE, viewer.userId!);
    return withTx(this.deps.db, async (tx) => {
      const access = await this.gate.load(tx, articleId, viewer);
      requirePublished(access);
      const poll = await this.requirePoll(tx, articleId, pollId, true);
      if (this.isClosed(poll)) throw new EngagementConflictError('POLL_CLOSED');
      if (req === null) {
        await repo.deleteVote(tx, pollId, viewer.userId!);
      } else {
        if (!(await repo.optionBelongsTo(tx, pollId, req.optionId!))) throw new ValidationError('optionId', req.optionId, 'must be an option of this poll');
        await repo.upsertVote(tx, pollId, viewer.userId!, req.optionId!, toPgTimestamp(systemNowMicros()));
      }
      return this.response(tx, poll, viewer, access);
    });
  }

  private async edit(tx: Db, articleId: string, viewer: Viewer): Promise<ArticleAccess> {
    const access = await this.gate.load(tx, articleId, viewer);
    if (!access.canEditPolls) throw new AccessDeniedError();
    return access;
  }

  private async requirePoll(tx: Db, articleId: string, pollId: string, forUpdate = false): Promise<repo.PollRow> {
    const poll = await repo.findPoll(tx, articleId, pollId, forUpdate);
    if (!poll) throw new ResourceNotFoundError('Poll', pollId);
    return poll;
  }

  private isClosed(poll: repo.PollRow): boolean {
    return poll.closesAt !== null && parsePgTimestamp(poll.closesAt) <= this.deps.clock.now();
  }

  private async response(tx: Db, poll: repo.PollRow, viewer: Viewer, access: ArticleAccess): Promise<PollResponse> {
    return (await this.responses(tx, [poll], viewer, access))[0]!;
  }

  private async responses(tx: Db, polls: repo.PollRow[], viewer: Viewer, access: ArticleAccess): Promise<PollResponse[]> {
    const ids = polls.map((p) => p.id);
    const options = await repo.optionsWithCounts(tx, ids);
    const mine = await repo.votesOf(tx, ids, viewer.userId);
    return polls.map((p) => {
      const own = options.filter((o) => o.poll_id === p.id);
      const closed = this.isClosed(p);
      const myVote = mine.get(p.id) ?? null;
      const visibility = p.resultsVisibility as ResultsVisibility;
      const resultsVisible = access.canEditPolls || closed || (visibility === 'after_vote' && myVote !== null);
      return {
        id: p.id,
        question: p.question,
        options: own.map((o) => ({ id: o.id, label: o.label, votes: resultsVisible ? o.votes : null })),
        resultsVisibility: visibility,
        closesAt: p.closesAt === null ? null : dbInstant(p.closesAt),
        closed,
        totalVotes: resultsVisible ? own.reduce((n, o) => n + o.votes, 0) : null,
        myVote,
        resultsVisible,
        canEdit: access.canEditPolls,
      };
    });
  }
}

function labels(raw: (string | null)[]): string[] {
  return raw.map((l) => javaTrim(l ?? ''));
}
