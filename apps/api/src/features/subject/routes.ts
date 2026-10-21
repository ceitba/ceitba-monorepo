// web/subject/SubjectController.

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { linkedJson } from '../commission/logic/linkedJson';
import { SubjectService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new SubjectService(deps);
  const tags = ['Subjects'];
  // Public. With a valid session/Bearer, each schedule correction's my_vote
  // carries the caller's vote; anonymous callers get null.
  r.get('/v1/subjects', {
    tags, summary: 'Get subjects organized by plan (section/year/semester)',
    query: { plan: param.string() }, currentUser: true,
  }, async ({ query, user }) => linkedJson(await svc.getSubjectsByPlanOrganized(query.plan!, user ? user.id : null)));
  r.get('/v1/subjects/{id}', { tags, summary: 'Get a subject by ID', params: { id: param.string() } },
    ({ params }) => svc.getSubjectById(params.id!));
});
