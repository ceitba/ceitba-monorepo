// web/highlight/HighlightController. Writes and /all are STAFF (policy.ts METHOD_RULES).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { HighlightRequest } from './dto';
import { HighlightService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new HighlightService(deps);
  const tags = ['Highlights'];
  r.get('/v1/highlights', { tags, summary: 'Home carousel highlights visible now' }, () => svc.listVisible());
  r.get('/v1/highlights/all', { tags, summary: 'All highlights, including inactive, scheduled and expired (STAFF)' }, () => svc.listAll());
  r.post('/v1/highlights', { tags, body: HighlightRequest, status: 201 }, ({ body }) => svc.create(body));
  r.put('/v1/highlights/{id}', { tags, params: { id: param.uuid() }, body: HighlightRequest }, ({ params, body }) => svc.update(params.id!, body));
  r.delete('/v1/highlights/{id}', { tags, params: { id: param.uuid() }, status: 204 }, async ({ params }) => { await svc.delete(params.id!); });
});
