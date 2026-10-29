// web/plan/SubjectPlanController. Writes are STAFF (policy.ts METHOD_RULES).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { CreateSubjectPlanRequest, UpdateSubjectPlanRequest } from './dto';
import { SubjectPlanService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new SubjectPlanService(deps);
  const tags = ['Subject by plan'];
  const ids = { planId: param.string(), subjectId: param.string() };

  r.get('/v1/plans/{planId}/subjects', {
    tags, summary: 'Get subjects by plan with filters (DB-backed)',
    params: { planId: param.string() },
    query: { year: param.int({ required: false }), semester: param.int({ required: false }), section: param.string({ required: false }), type: param.string({ required: false }) },
  }, ({ params, query }) => svc.getSubjectsByPlan(params.planId!, { year: query.year, semester: query.semester, section: query.section, type: query.type }));

  r.get('/v1/plans/{planId}/requirements', {
    tags, summary: 'Credits the plan asks for per elective group (synced from ITBA)', params: { planId: param.string() },
  }, ({ params }) => svc.getRequirements(params.planId!));

  r.get('/v1/plans/subjects/{subjectId}/plans', { tags, summary: 'List every plan that contains a given subject', params: { subjectId: param.string() } },
    ({ params }) => svc.getPlansForSubject(params.subjectId!));

  r.get('/v1/plans/{planId}/subject/{subjectId}', { tags, summary: 'Get one specific subject-within-plan', params: ids },
    ({ params }) => svc.getOne(params.planId!, params.subjectId!));

  r.post('/v1/plans/{planId}/subject', { tags, summary: 'Create a subject-within-plan (STAFF only)', params: { planId: param.string() }, body: CreateSubjectPlanRequest, status: 201 },
    ({ params, body }) => svc.create(params.planId!, body));

  r.put('/v1/plans/{planId}/subject/{subjectId}', { tags, summary: 'Update a subject-within-plan (STAFF only)', params: ids, body: UpdateSubjectPlanRequest },
    ({ params, body }) => svc.update(params.planId!, params.subjectId!, body));

  r.delete('/v1/plans/{planId}/subject/{subjectId}', { tags, summary: 'Delete a subject-within-plan (STAFF only)', params: ids, status: 204 },
    async ({ params }) => { await svc.delete(params.planId!, params.subjectId!); });
});
