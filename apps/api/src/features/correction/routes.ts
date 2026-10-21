// web/correction/ScheduleCorrectionController + StaffScheduleCorrectionController.
// The student routes fall under anyRequest (allowlisted session); the staff
// ones under /v1/staff/** plus hasRole('STAFF') (policy.ts METHOD_RULES).

import { defineRoutes, json, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { bindSlots, CORRECTION_STATUSES, SuggestCorrectionRequest, VoteCorrectionRequest } from './dto';
import { ScheduleCorrectionService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new ScheduleCorrectionService(deps);
  const tags = ['Schedule corrections'];
  const staffTags = ['Schedule corrections (staff)'];
  const id = { id: param.uuid() };

  r.post('/v1/commissions/{commissionId}/schedule-corrections', {
    tags, summary: 'Suggest a corrected schedule for a commission',
    params: { commissionId: param.string() }, body: SuggestCorrectionRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, async ({ user, params: p, body }) => {
    const result = await svc.suggest(p.commissionId!, user!.id, bindSlots(body.schedule!));
    return json(result, result.created ? 201 : 200);
  });

  r.put('/v1/schedule-corrections/{id}/vote', {
    tags, summary: "Confirm or reject a schedule correction (replaces the caller's vote)",
    params: id, body: VoteCorrectionRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, ({ user, params: p, body }) => svc.vote(p.id!, user!.id, body.type!));

  r.delete('/v1/schedule-corrections/{id}/vote', {
    tags, summary: "Remove the caller's vote on a schedule correction", params: id, currentUser: true, argOrder: ['user', 'params'],
  }, ({ user, params: p }) => svc.removeVote(p.id!, user!.id));

  r.get('/v1/me/schedule-corrections', { tags, summary: "The caller's own schedule corrections, newest first", currentUser: true },
    ({ user }) => svc.mine(user!.id));

  r.post('/v1/me/schedule-corrections/{id}/seen', {
    tags, summary: "Dismiss the 'your correction was applied' notice", params: id, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.markSeen(p.id!, user!.id); return noContent(); });

  r.get('/v1/staff/schedule-corrections', {
    tags: staffTags, summary: 'Schedule corrections, newest first, optionally filtered by status',
    query: {
      status: param.enum(CORRECTION_STATUSES, 'org.ceitba.api.domain.correction.ScheduleCorrectionStatus', { required: false }),
      page: param.int({ def: 1, primitive: true }),
      limit: param.int({ def: 20, primitive: true }),
    },
  }, ({ query: q }) => svc.staffList(q.status, q.page!, q.limit!));

  r.post('/v1/staff/schedule-corrections/{id}/apply', {
    tags: staffTags, summary: 'Apply a pending/applied correction (supersedes the current applied one)',
    params: id, currentUser: true, argOrder: ['user', 'params'],
  }, ({ user, params: p }) => svc.staffApply(p.id!, user!.id));

  r.post('/v1/staff/schedule-corrections/{id}/reject', {
    tags: staffTags, summary: 'Reject a pending correction or revert an applied one',
    params: id, currentUser: true, argOrder: ['user', 'params'],
  }, ({ user, params: p }) => svc.staffReject(p.id!, user!.id));
});
