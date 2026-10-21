// web/proposal/{ProposalController, ProposalAttachmentController, StaffProposalController}.
//
// Every endpoint needs a signed-in, allowlisted user (policy.ts URL rules);
// /v1/staff/proposals/** is ROLE_MODERATOR (+ the class-level @PreAuthorize in
// METHOD_RULES). Responses identify people only by per-proposal pseudonyms.
// Pagination: ?page (1-based) & limit (1..50) -> {data, meta:{total, page, limit}}.
// @CurrentUser is the first Java parameter everywhere, so the user is resolved
// (JIT-provisioned) before path/query/body conversion errors.

import { principal } from '../../http/auth/context';
import { hasRole } from '../../http/auth/principal';
import type { AppContext } from '../../http/context';
import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import {
  CreateProposalCommentRequest, CreateProposalRequest, PROPOSAL_STATUSES, PROPOSAL_TOPICS, ProposalVoteRequest, queryEnum,
  RejectProposalRequest, SignUploadRequest, UpdateProposalLifecycleRequest, type ProposalStatus,
} from './dto';
import { ProposalModerationService, ProposalService, mediaUploads } from './service';

/** ProposalController.isModerator(auth): the ROLE_MODERATOR authority. */
const isModerator = (c: AppContext) => hasRole(principal(c), 'MODERATOR');

export default defineRoutes((r, deps) => {
  const svc = new ProposalService(deps);
  const moderation = new ProposalModerationService(deps);
  const uploads = mediaUploads(deps);
  const tags = ['Proposals'];
  const staffTags = ['Proposals (moderation)'];
  const id = param.uuid();
  const paging = { page: param.int({ def: 1, primitive: true }), limit: param.int({ def: 20, primitive: true }) };

  // --- ProposalController --------------------------------------------------

  r.get('/v1/proposals', {
    tags, summary: 'Approved proposals, newest first, optionally by topic', currentUser: true, argOrder: ['user', 'query'],
    query: { topic: queryEnum(PROPOSAL_TOPICS, 'org.ceitba.api.domain.proposal.ProposalTopic'), ...paging },
  }, ({ user, query }) => svc.listApproved(query.topic, query.page!, query.limit!, user!.id));

  r.get('/v1/me/proposals', {
    tags, summary: 'My proposals in any moderation status, newest first', currentUser: true, argOrder: ['user', 'query'], query: paging,
  }, ({ user, query }) => svc.listMine(user!.id, query.page!, query.limit!));

  r.get('/v1/proposals/{id}', {
    tags, summary: 'A proposal: approved, mine, or any for moderators (404 otherwise)', currentUser: true, argOrder: ['user', 'params'], params: { id },
  }, ({ c, user, params }) => svc.get(params.id!, user!.id, isModerator(c)));

  r.post('/v1/proposals', {
    tags, summary: 'Submit a proposal for moderation (status PENDING)', currentUser: true, argOrder: ['user', 'body'],
    body: CreateProposalRequest, status: 201,
  }, ({ user, body }) => svc.create(user!.id, body));

  r.put('/v1/proposals/{id}/vote', {
    tags, summary: 'Cast or change my vote (UP/DOWN)', currentUser: true, argOrder: ['user', 'params', 'body'], params: { id }, body: ProposalVoteRequest,
  }, ({ user, params, body }) => svc.vote(params.id!, user!.id, body.value!));

  r.delete('/v1/proposals/{id}/vote', {
    tags, summary: 'Remove my vote (no-op if none)', currentUser: true, argOrder: ['user', 'params'], params: { id },
  }, ({ user, params }) => svc.removeVote(params.id!, user!.id));

  r.get('/v1/proposals/{id}/comments', {
    tags, summary: 'Top-level comments newest first, each with its replies', currentUser: true, argOrder: ['user', 'params', 'query'],
    params: { id }, query: paging,
  }, ({ c, user, params, query }) => svc.listComments(params.id!, user!.id, isModerator(c), query.page!, query.limit!));

  r.post('/v1/proposals/{id}/comments', {
    tags, summary: 'Comment (or reply with parentId) under my pseudonym', currentUser: true, argOrder: ['user', 'params', 'body'],
    params: { id }, body: CreateProposalCommentRequest, status: 201,
  }, ({ user, params, body }) => svc.addComment(params.id!, user!.id, body));

  r.delete('/v1/proposals/{id}/comments/{commentId}', {
    tags, summary: 'Delete my own comment', currentUser: true, argOrder: ['user', 'params'], params: { id, commentId: param.uuid() }, status: 204,
  }, async ({ user, params }) => { await svc.deleteOwnComment(params.id!, params.commentId!, user!.id); });

  // --- ProposalAttachmentController -----------------------------------------
  // jpeg, png, webp (5 MB) or pdf (10 MB), per-user quota proposal-attachments;
  // 501 when storage is not configured (UnconfiguredObjectStorage.presignPut).

  r.post('/v1/proposals/attachments/sign-upload', {
    tags, summary: 'Sign a PUT upload of a proposal attachment', currentUser: true, argOrder: ['user', 'body'], body: SignUploadRequest,
  }, ({ user, body }) => uploads.signProposalAttachment(user!.id, { filename: body.filename!, contentType: body.contentType!, sizeBytes: body.sizeBytes! }));

  // --- StaffProposalController (MODERATOR) ----------------------------------

  r.get('/v1/staff/proposals', {
    tags: staffTags, summary: 'Proposals in a moderation status (default PENDING), oldest first', currentUser: true, argOrder: ['user', 'query'],
    query: { status: queryEnum(PROPOSAL_STATUSES, 'org.ceitba.api.domain.ProposalStatus', 'PENDING'), ...paging },
  }, ({ user, query }) => moderation.list(query.status as ProposalStatus, query.page!, query.limit!, user!.id));

  r.post('/v1/staff/proposals/{id}/approve', {
    tags: staffTags, summary: 'Approve a pending proposal', currentUser: true, argOrder: ['user', 'params'], params: { id },
  }, ({ user, params }) => moderation.approve(params.id!, user!.id));

  r.post('/v1/staff/proposals/{id}/reject', {
    tags: staffTags, summary: 'Reject a pending proposal, or take down an approved one', currentUser: true, argOrder: ['user', 'params', 'body'],
    params: { id }, body: RejectProposalRequest,
  }, ({ user, params, body }) => moderation.reject(params.id!, user!.id, body.reason!));

  r.patch('/v1/staff/proposals/{id}', {
    tags: staffTags, summary: "Set an approved proposal's lifecycle (ABIERTO/ACEPTADO/CERRADO)", currentUser: true, argOrder: ['user', 'params', 'body'],
    params: { id }, body: UpdateProposalLifecycleRequest,
  }, ({ user, params, body }) => moderation.setLifecycle(params.id!, user!.id, body.lifecycle!));

  r.delete('/v1/staff/proposals/{id}/comments/{commentId}', {
    tags: staffTags, summary: 'Remove any comment on a proposal', params: { id, commentId: param.uuid() }, status: 204,
  }, async ({ params }) => { await moderation.deleteComment(params.id!, params.commentId!); });
});
