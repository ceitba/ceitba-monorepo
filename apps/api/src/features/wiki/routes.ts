// web/wiki/SubjectBookmarkController. GET /v1/wiki/bookmarks/* is public
// (URL rule); the list and the writes need a session (anyRequest rule).
// {subjectId} has no regex: "93.12" binds whole (PathPattern, no suffix matching).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { SubjectBookmarkService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new SubjectBookmarkService(deps);
  const tags = ['Wiki'];
  const params = { subjectId: param.string() };

  r.get('/v1/wiki/bookmarks', { tags, summary: 'Materias fijadas del usuario actual (más recientes primero)', currentUser: true },
    ({ user }) => svc.pinned(user!.id));
  r.get('/v1/wiki/bookmarks/{subjectId}', { tags, summary: 'Estado de bookmark del usuario y conteo global', params, currentUser: true },
    ({ params: p, user }) => svc.getState(p.subjectId!, user?.id ?? null));
  r.post('/v1/wiki/bookmarks/{subjectId}', { tags, summary: 'Crear bookmark (usuario actual); 409 BOOKMARK_LIMIT pasadas las 30', params, currentUser: true },
    ({ params: p, user }) => svc.upsert(p.subjectId!, user!.id));
  r.put('/v1/wiki/bookmarks/{subjectId}', { tags, summary: 'Setear bookmark ON (idempotente)', params, currentUser: true },
    ({ params: p, user }) => svc.upsert(p.subjectId!, user!.id));
  r.delete('/v1/wiki/bookmarks/{subjectId}', { tags, summary: 'Eliminar bookmark (idempotente)', params, currentUser: true, status: 204 },
    async ({ params: p, user }) => { await svc.remove(p.subjectId!, user!.id); });
});
