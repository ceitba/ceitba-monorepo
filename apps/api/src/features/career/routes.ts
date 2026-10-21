// web/career/CareerController. Writes are STAFF only through policy.ts
// METHOD_RULES ('POST /v1/careers' etc.), checked after the body is validated
// like @PreAuthorize.

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { CreateCareerRequest, CreatePlanRequest, UpdateCareerRequest } from './dto';
import { CareerService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new CareerService(deps);
  const tags = ['Careers'];

  r.get('/v1/careers/plans', { tags, summary: 'Get careers with their plans' }, () => svc.getCareersWithPlans());
  r.get('/v1/careers', { tags, summary: 'Get all careers' }, () => svc.getAllCareers());
  r.get('/v1/careers/{id}', { tags, summary: 'Get career by ID', params: { id: param.string() } }, ({ params }) => svc.getCareerById(params.id!));

  r.post('/v1/careers', { tags, summary: 'Create a career (STAFF only)', body: CreateCareerRequest, status: 201 },
    ({ body }) => svc.create(body));
  r.put('/v1/careers/{id}', { tags, summary: "Update a career's name (STAFF only)", params: { id: param.string() }, body: UpdateCareerRequest },
    ({ params, body }) => svc.update(params.id!, body));
  r.post('/v1/careers/{id}/plans', { tags, summary: 'Add a plan to a career (STAFF only). 409 if the plan id is already used.', params: { id: param.string() }, body: CreatePlanRequest, status: 201 },
    ({ params, body }) => svc.addPlan(params.id!, body));
  r.delete('/v1/careers/{id}', { tags, summary: 'Delete a career (STAFF only). Returns 409 if it has plans/notes/users.', params: { id: param.string() }, status: 204 },
    async ({ params }) => { await svc.delete(params.id!); });
});
