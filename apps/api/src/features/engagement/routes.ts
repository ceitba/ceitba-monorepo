// web/engagement: comments and polls of newsletter articles (docs/NEWSLETTER-ENGAGEMENT.md).
// The GETs are public through the `GET /v1/articles/**` rule of policy.ts; every write is an
// authenticated route and the services check editor/STAFF powers.

import type { Deps } from '../../deps';
import { currentUser, optionalUser, staffPowers } from '../../http/auth/context';
import type { AppContext } from '../../http/context';
import { ValidationError } from '../../http/errors';
import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { OrganizationMembershipService } from '../news/memberships';
import { CommentService } from './comments';
import {
  CommentSettingsRequest, CreateCommentRequest, CreatePollRequest, PinCommentRequest, PollVoteRequest, ReportCommentRequest, UpdatePollRequest,
} from './dto';
import { ArticleGate, type Viewer } from './gate';
import { PollService } from './polls';

const commentTags = ['Article comments'];
const pollTags = ['Article polls'];

async function viewer(c: AppContext, signedIn: boolean): Promise<Viewer> {
  const user = signedIn ? await currentUser(c) : await optionalUser(c);
  const userId = user?.id ?? null;
  return { userId, isStaff: await staffPowers(c).isStaff(userId) };
}

export function engagementServices(deps: Deps) {
  const gate = new ArticleGate(new OrganizationMembershipService(deps));
  return { comments: new CommentService(deps, gate), polls: new PollService(deps, gate) };
}

export default defineRoutes((r, deps) => {
  const { comments, polls } = engagementServices(deps);
  const articleId = { id: param.string() };
  const comment = { id: param.string(), commentId: param.uuid() };
  const poll = { id: param.string(), pollId: param.uuid() };

  // ---------------------------------------------------------------- comments

  r.get('/v1/articles/{id}/comments', {
    tags: commentTags, summary: 'Comment threads of an article', params: articleId, query: { sort: param.string({ required: false }) },
  }, async ({ c, params, query }) => {
    const sort = query.sort ?? 'top';
    if (sort !== 'top' && sort !== 'new') throw new ValidationError('sort', sort, "must be 'top' or 'new'");
    return comments.thread(params.id!, await viewer(c, false), sort);
  });

  r.post('/v1/articles/{id}/comments', {
    tags: commentTags, summary: 'Comment on an article, or reply to a top-level comment', params: articleId, body: CreateCommentRequest, status: 201,
  }, async ({ c, params, body }) => comments.create(params.id!, await viewer(c, true), body));

  // Literal segment: wins over /comments/{commentId}.
  r.put('/v1/articles/{id}/comments/settings', {
    tags: commentTags, summary: 'Turn comments on or off (article editors, STAFF)', params: articleId, body: CommentSettingsRequest,
  }, async ({ c, params, body }) => comments.settings(params.id!, await viewer(c, true), body.enabled!));

  r.delete('/v1/articles/{id}/comments/{commentId}', {
    tags: commentTags, summary: 'Delete a comment (its author, article editors, STAFF)', params: comment, status: 204,
  }, async ({ c, params }) => { await comments.delete(params.id!, params.commentId!, await viewer(c, true)); });

  r.put('/v1/articles/{id}/comments/{commentId}/like', { tags: commentTags, summary: 'Like a comment', params: comment },
    async ({ c, params }) => comments.like(params.id!, params.commentId!, await viewer(c, true), true));

  r.delete('/v1/articles/{id}/comments/{commentId}/like', { tags: commentTags, summary: 'Remove a like', params: comment },
    async ({ c, params }) => comments.like(params.id!, params.commentId!, await viewer(c, true), false));

  r.put('/v1/articles/{id}/comments/{commentId}/report', {
    tags: commentTags, summary: 'Report a comment (one report per user; 3 reports hide it)', params: comment, body: ReportCommentRequest, status: 204,
  }, async ({ c, params, body }) => { await comments.report(params.id!, params.commentId!, await viewer(c, true), body); });

  r.put('/v1/articles/{id}/comments/{commentId}/pin', {
    tags: commentTags, summary: 'Pin or unpin a top-level comment (article editors, STAFF)', params: comment, body: PinCommentRequest,
  }, async ({ c, params, body }) => comments.pin(params.id!, params.commentId!, await viewer(c, true), body.pinned!));

  r.post('/v1/articles/{id}/comments/{commentId}/restore', {
    tags: commentTags, summary: 'Show a hidden comment again and dismiss its reports (article editors, STAFF)', params: comment,
  }, async ({ c, params }) => comments.restore(params.id!, params.commentId!, await viewer(c, true)));

  // ---------------------------------------------------------------- polls

  r.get('/v1/articles/{id}/polls', { tags: pollTags, summary: 'Polls of an article', params: articleId },
    async ({ c, params }) => polls.list(params.id!, await viewer(c, false)));

  r.get('/v1/articles/{id}/polls/{pollId}', { tags: pollTags, summary: 'A poll (counts only when the caller may see them)', params: poll },
    async ({ c, params }) => polls.get(params.id!, params.pollId!, await viewer(c, false)));

  r.post('/v1/articles/{id}/polls', {
    tags: pollTags, summary: 'Create a poll (article editors, STAFF)', params: articleId, body: CreatePollRequest, status: 201,
  }, async ({ c, params, body }) => polls.create(params.id!, await viewer(c, true), body));

  r.patch('/v1/articles/{id}/polls/{pollId}', {
    tags: pollTags, summary: 'Edit, close or reopen a poll (article editors, STAFF)', params: poll, body: UpdatePollRequest,
  }, async ({ c, params, body }) => polls.update(params.id!, params.pollId!, await viewer(c, true), body));

  r.delete('/v1/articles/{id}/polls/{pollId}', {
    tags: pollTags, summary: 'Delete a poll (article editors, STAFF)', params: poll, status: 204,
  }, async ({ c, params }) => { await polls.delete(params.id!, params.pollId!, await viewer(c, true)); });

  r.put('/v1/articles/{id}/polls/{pollId}/vote', { tags: pollTags, summary: 'Vote, or change the vote', params: poll, body: PollVoteRequest },
    async ({ c, params, body }) => polls.vote(params.id!, params.pollId!, await viewer(c, true), body));

  r.delete('/v1/articles/{id}/polls/{pollId}/vote', { tags: pollTags, summary: 'Remove the vote', params: poll },
    async ({ c, params }) => polls.vote(params.id!, params.pollId!, await viewer(c, true), null));
});
