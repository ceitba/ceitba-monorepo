// GET /v1/plans/{planId}/requirements: the credits each plan asks for per
// elective group (docs/ITBA-GATEWAY.md "Elective groups"), written by the
// sync (sync-data-sync covers the gateway -> table path). Public like
// /v1/plans/{planId}/subjects.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Sql } from 'postgres';
import { bearer, mintJwt, seedCareer, seedPlan, useServer } from '../support';

const api = useServer();

async function requirement(db: Sql, planId: string, section: string, credits: number, year: number, semester: number) {
  await db`INSERT INTO public.plan_section_requirement (plan_id, section, credits, year, semester)
           VALUES (${planId}, ${section}, ${credits}, ${year}, ${semester})`;
}

beforeAll(async () => {
  await seedCareer(api.db, 'A', 'Ingeniería en Informática y Analytics');
  await seedPlan(api.db, 'A22', 'A', 'A22');
  await seedPlan(api.db, 'S10-Rev23', 'A', 'S10-Rev23');
});

describe('PlanSectionRequirementsIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.plan_section_requirement`;
    await requirement(api.db, 'A22', 'Electivas Social', 12, 3, 2);
    await requirement(api.db, 'A22', 'Electivas Informática', 15, 3, 1);
    await requirement(api.db, 'A22', 'Electivas Orientación', 18, 1, 2);
    await requirement(api.db, 'A22', 'Electivas Analytics', 15, 3, 2);
    await requirement(api.db, 'A22', 'Electivas Gestíon', 18, 3, 1);
    await requirement(api.db, 'S10-Rev23', 'Electivas', 27, 4, 2);
  });

  test('listsThePlanRequirementsOrderedByYearSemesterSection', async () => {
    const r = await api.get('/v1/plans/A22/requirements');
    expect(r.status).toBe(200);
    expect(r.text).toBe('['
      + '{"section":"Electivas Orientación","credits":18,"year":1,"semester":2},'
      + '{"section":"Electivas Gestíon","credits":18,"year":3,"semester":1},'
      + '{"section":"Electivas Informática","credits":15,"year":3,"semester":1},'
      + '{"section":"Electivas Analytics","credits":15,"year":3,"semester":2},'
      + '{"section":"Electivas Social","credits":12,"year":3,"semester":2}]');
  });

  test('aPlanWithoutRequirementsReturnsAnEmptyList', async () => {
    await seedPlan(api.db, 'I22', 'A', 'I22');
    for (const plan of ['I22', 'NO-SUCH-PLAN']) {
      const r = await api.get(`/v1/plans/${plan}/requirements`);
      expect(r.status).toBe(200);
      expect(r.text).toBe('[]');
    }
  });

  test('isPublicLikeTheSubjectsOfAPlan', async () => {
    const anonymous = await api.get('/v1/plans/S10-Rev23/requirements');
    const user = await api.get('/v1/plans/S10-Rev23/requirements', { as: bearer(await mintJwt({ email: 'regular@itba.edu.ar' })) });
    for (const r of [anonymous, user]) {
      expect(r.status).toBe(200);
      expect(r.text).toBe('[{"section":"Electivas","credits":27,"year":4,"semester":2}]');
    }
  });
});
