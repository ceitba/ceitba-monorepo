// web/studygroup/StudyGroupController. hasRole('USER') on every route comes
// from policy.ts METHOD_RULES. The moderator flag is the ROLE_MODERATOR
// authority of the caller (isModerator(auth) in Java), not a DB lookup here.

import { principal } from '../../http/auth/context';
import { hasRole } from '../../http/auth/principal';
import type { AppContext } from '../../http/context';
import { defineRoutes, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { CreateStudyGroupRequest, STUDY_GROUP_TYPES, UpdateStudyGroupRequest } from './dto';
import { StudyGroupService } from './service';

const isModerator = (c: AppContext) => hasRole(principal(c), 'MODERATOR');

export default defineRoutes((r, deps) => {
  const svc = new StudyGroupService(deps);
  const tags = ['Study groups'];
  const params = { id: param.uuid() };

  r.get('/v1/study-groups', {
    tags, summary: 'List study groups, soonest due first. Upcoming only unless upcoming=false. Paginated as {data, meta}; items omit participants.',
    currentUser: true, argOrder: ['user', 'query'],
    query: {
      subject: param.string({ required: false }),
      type: param.enum(STUDY_GROUP_TYPES, 'org.ceitba.api.domain.StudyGroupType', { required: false }),
      upcoming: param.bool({ def: true }),
      page: param.int({ def: 1, primitive: true }),
      limit: param.int({ def: 20, primitive: true }),
    },
  }, ({ c, user, query: q }) => svc.list(user!.id, isModerator(c), q.subject, q.type, q.upcoming!, q.page!, q.limit!));

  r.get('/v1/me/study-groups', {
    tags, summary: 'Study groups the caller owns or joined, soonest due first. Upcoming only unless upcoming=false.',
    currentUser: true, argOrder: ['user', 'query'], query: { upcoming: param.bool({ def: true }) },
  }, ({ c, user, query: q }) => svc.listMine(user!.id, isModerator(c), q.upcoming!));

  r.get('/v1/study-groups/{id}', {
    tags, summary: 'One study group with its participants (name and avatar only). contactLink is members-only.',
    params, currentUser: true, argOrder: ['user', 'params'],
  }, ({ c, user, params: p }) => svc.get(user!.id, isModerator(c), p.id!));

  r.post('/v1/study-groups', {
    tags, summary: 'Create a study group; the caller becomes its owner and first participant',
    body: CreateStudyGroupRequest, currentUser: true, argOrder: ['user', 'body'], status: 201,
  }, ({ user, body }) => svc.create(user!.id, body));

  r.patch('/v1/study-groups/{id}', {
    tags, summary: 'Edit a study group (owner or moderator). 409 when capacity would drop below the member count.',
    params, body: UpdateStudyGroupRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, ({ c, user, params: p, body }) => svc.update(user!.id, isModerator(c), p.id!, body));

  r.delete('/v1/study-groups/{id}', {
    tags, summary: 'Delete a study group (owner or moderator)', params, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ c, user, params: p }) => { await svc.delete(user!.id, isModerator(c), p.id!); return noContent(); });

  r.post('/v1/study-groups/{id}/join', {
    tags, summary: 'Join a study group. Idempotent for members; 409 StudyGroupFull / StudyGroupPastDue otherwise.',
    params, currentUser: true, argOrder: ['user', 'params'],
  }, ({ c, user, params: p }) => svc.join(user!.id, isModerator(c), p.id!));

  r.delete('/v1/study-groups/{id}/membership', {
    tags, summary: 'Leave a study group (404 if not a member). If the owner leaves, ownership passes to the earliest remaining joiner, or the group is deleted when nobody else is in it.',
    params, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.leave(user!.id, p.id!); return noContent(); });
});
