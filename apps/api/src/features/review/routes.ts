// Subject reviews (docs/SUBJECT-REVIEWS.md). The student routes fall under
// anyRequest (allowlisted session); the staff ones under /v1/staff/** plus
// hasRole('STAFF') (policy.ts METHOD_RULES).

import { defineRoutes, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { LookupProfessorRequest, ReportReviewRequest, SaveReviewRequest } from './dto';
import { SubjectReviewService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new SubjectReviewService(deps);
  const tags = ['Subject reviews'];
  const staffTags = ['Subject reviews (staff)'];
  const subject = { subjectId: param.string() };
  const id = { id: param.uuid() };

  r.get('/v1/subjects/{subjectId}/reviews', {
    tags, summary: "A subject's reviews (newest term first) and the professors they name; anonymous, the caller's own flagged mine",
    params: subject, currentUser: true, argOrder: ['user', 'params'],
  }, ({ user, params: p }) => svc.list(p.subjectId!, user!.id));

  r.post('/v1/subjects/{subjectId}/reviews', {
    tags, summary: 'Review a subject for a term (one per student, subject and term)',
    params: subject, body: SaveReviewRequest, currentUser: true, argOrder: ['user', 'params', 'body'], status: 201,
  }, ({ user, params: p, body }) => svc.create(p.subjectId!, user!.id, body));

  r.put('/v1/subject-reviews/{id}', {
    tags, summary: "Edit the caller's review", params: id, body: SaveReviewRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, ({ user, params: p, body }) => svc.update(p.id!, user!.id, body));

  r.delete('/v1/subject-reviews/{id}', {
    tags, summary: "Delete the caller's review", params: id, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.delete(p.id!, user!.id); return noContent(); });

  r.put('/v1/subject-reviews/{id}/helpful', {
    tags, summary: 'Mark a review as helpful ("Me sirvió"); idempotent', params: id, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.setHelpful(p.id!, user!.id, true); return noContent(); });

  r.delete('/v1/subject-reviews/{id}/helpful', {
    tags, summary: 'Remove the caller\'s "Me sirvió"', params: id, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.setHelpful(p.id!, user!.id, false); return noContent(); });

  r.put('/v1/subject-reviews/{id}/report', {
    tags, summary: 'Report a review (one report per user; 3 reports hide it)',
    params: id, body: ReportReviewRequest, currentUser: true, argOrder: ['user', 'params', 'body'], status: 204,
  }, async ({ user, params: p, body }) => { await svc.report(p.id!, user!.id, body); return noContent(); });

  r.post('/v1/professors/lookup', {
    tags, summary: 'The professor with this ITBA address, named from the ITBA directory; the address is never returned',
    body: LookupProfessorRequest, currentUser: true, argOrder: ['user', 'body'],
  }, ({ user, body }) => svc.lookupProfessor(user!.id, body.email!));

  r.get('/v1/staff/subject-reviews', {
    tags: staffTags, summary: 'Reviews hidden by reports, most recently hidden first, with their reports',
  }, () => svc.staffHidden());

  r.post('/v1/staff/subject-reviews/{id}/restore', {
    tags: staffTags, summary: 'Show a hidden review again and clear its reports', params: id, status: 204,
  }, async ({ params: p }) => { await svc.staffRestore(p.id!); return noContent(); });

  r.delete('/v1/staff/subject-reviews/{id}', {
    tags: staffTags, summary: 'Delete a review', params: id, status: 204,
  }, async ({ params: p }) => { await svc.staffDelete(p.id!); return noContent(); });
});
