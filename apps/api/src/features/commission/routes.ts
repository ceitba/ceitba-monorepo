// web/commission/CommissionController. Public (policy URL rule GET /v1/commissions).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { CommissionService } from './service';

export default defineRoutes((r, deps) => {
  const svc = new CommissionService(deps);
  r.get('/v1/commissions', { tags: ['Commissions'], summary: "Current commissions of a plan's subjects", query: { plan: param.string() } },
    ({ query }) => svc.currentByPlan(query.plan!));
});
