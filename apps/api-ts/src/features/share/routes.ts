// web/share/ShareSessionController. GET /v1/share/sessions/* is public (URL
// rule); the writes fall under anyRequest (allowlisted session).

import { defineRoutes, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { CreateShareSessionRequest, JoinShareSessionRequest } from './dto';
import { jsonWithRaw } from '../../lib/jackson';
import { ShareSessionService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new ShareSessionService(deps);
  const tags = ['Share'];
  const params = { token: param.string() };

  r.post('/v1/share/sessions', {
    tags, summary: 'Create a share session anchored to one of my saved schedules',
    body: CreateShareSessionRequest, currentUser: true, argOrder: ['user', 'body'],
  }, async ({ user, body }) => jsonWithRaw(await svc.create(user!, body), 201));

  r.get('/v1/share/sessions/{token}', { tags, summary: 'Public read of a share session by its token', params },
    async ({ params: p }) => jsonWithRaw(await svc.readByToken(p.token!)));

  r.post('/v1/share/sessions/{token}/join', {
    tags, summary: 'Attach my saved schedule to this session (or replace my prior pick)',
    params, body: JoinShareSessionRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, async ({ user, params: p, body }) => jsonWithRaw(await svc.join(user!, p.token!, body)));

  r.delete('/v1/share/sessions/{token}/leave', {
    tags, summary: 'Remove my participation from this session', params, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.leave(user!, p.token!); return noContent(); });

  r.delete('/v1/share/sessions/{token}', {
    tags, summary: 'Delete a session (creator only). 404 to non-creators.', params, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ user, params: p }) => { await svc.delete(user!, p.token!); return noContent(); });
});
