// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbAdminEvalIT.java
// #costsAcceptDateOnlyAndIsoDatetimeAndRejectGarbage. The IT's `run()` (a manual pipeline run
// advanced with the fake executors) only exists to create kb_llm_usage rows "now": here they are
// inserted directly, as the executors record them. Plus the cost summary and quota shapes
// (StaffKbAdminController#summary / #quota, docs/SUBJECT-WIKI-ADMIN.md §3 and "DigitalOcean quota").
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, supports, useServer } from '../support';

const api = useServer();
const STAFF = 'staff@itba.edu.ar';
const staff = async () => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));
const hasRuns = await supports('GET /v1/staff/kb/pipeline/runs');

async function call(path: string, expected: number, query?: Record<string, string>) {
  const r = await api.get(path, { as: await staff(), query });
  if (r.status !== expected) throw new Error(`GET ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

/** LocalDate.now(ART) + days. */
function artDate(days = 0): string {
  const d = new Date(Date.now() - 3 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function usage(model: string, stage: string, subject: string | null, cost: string, ago = '0 seconds', simulated = true) {
  await api.db`INSERT INTO wiki.kb_llm_usage (id, created_at, model, mode, stage, subject_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, simulated)
               VALUES (gen_random_uuid(), now() - ${ago}::interval, ${model}, 'SYNC', ${stage}, ${subject}, 1000, 250, 300, ${cost}, ${simulated})`;
}

describe('KbAdminEvalIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.kb_llm_usage, wiki.kb_run CASCADE`;
    await api.db`TRUNCATE public."user", public.plan_subject, public.subject, public.plan, public.careers CASCADE`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
    await seedUser(api.db, STAFF, { name: 'Staff' });
    await seedStaff(api.db, STAFF);
  });

  test('costsAcceptDateOnlyAndIsoDatetimeAndRejectGarbage', async () => {
    // usage rows created now (the IT's run(): DIGEST, PLAN and WRITE of both subjects)
    await usage('glm-5.3-flash', 'DIGEST', '61.12', '0.000100');
    await usage('glm-5.3', 'PLAN', '61.12', '0.000200');
    await usage('glm-5.3', 'WRITE', '81.07', '0.000300');
    const today = artDate();
    const tomorrow = artDate(1);
    const rows = (await call('/v1/staff/kb/costs', 200, { from: today, to: today, groupBy: 'model' })).json;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].key).toBe(rows[0].model);
    expect((await call('/v1/staff/kb/costs', 200, { from: tomorrow, to: tomorrow })).json).toEqual([]);
    const weekly = (await call('/v1/staff/kb/costs', 200, { from: today, groupBy: 'week,stage' })).json;
    expect(weekly[0].key).toBe(`${weekly[0].week}|${weekly[0].stage}`);
    const iso = new Date(Date.now() - 3600_000).toISOString();   // OffsetDateTime.now().minusHours(1).toString()
    expect((await call('/v1/staff/kb/costs', 200, { from: iso })).json.length).toBeGreaterThan(0);
    expect((await call('/v1/staff/kb/costs', 200, { from: `${today}T00:00:00-03:00`, to: `${today}T23:59:59.999-03:00` })).json.length).toBeGreaterThan(0);
    for (const bad of ['2026-07-32', '11/07/2026', 'nope']) {
      const err = (await call(`/v1/staff/kb/costs?from=${bad}`, 400)).json;
      expect(err.error).toBe('ValidationError');
      expect(err.message).toContain('from');
      expect(err.message).not.toContain('Failed to convert');
    }
    expect((await call('/v1/staff/kb/costs?to=x', 400)).json.error).toBe('ValidationError');
    await call(`/v1/staff/kb/costs?from=${tomorrow}&to=${today}`, 400);
    // Other typed parameters: a clean ValidationError too.
    const uuid = (await call('/v1/staff/kb/evals/leaderboard?setId=not-a-uuid', 400)).json;
    expect(uuid.error).toBe('ValidationError');
    expect(uuid.message).toStartWith('setId:');
    expect(uuid.message).not.toContain('Failed to convert');
    if (hasRuns) expect((await call('/v1/staff/kb/pipeline/runs?limit=abc', 400)).json.error).toBe('ValidationError');
  });
});

describe('KbCostService shapes', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.kb_llm_usage, wiki.kb_run CASCADE`;
    if (!(await api.db`SELECT 1 FROM public."user" WHERE email = ${STAFF}`).length) await seedUser(api.db, STAFF, { name: 'Staff' });
    await seedStaff(api.db, STAFF);
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now()) ON CONFLICT DO NOTHING`;
  });

  test('rowsGroupSortAndRoundLikeJava', async () => {
    await usage('glm-5.3', 'WRITE', '61.12', '0.123456');
    await usage('glm-5.3', 'PLAN', null, '0.000050');
    await usage('anthropic-claude-haiku-4.5', 'WRITE', '61.12', '1.000049', '2 days');
    const byStage = await call('/v1/staff/kb/costs', 200, { groupBy: 'stage' });
    expect(byStage.text).toBe('[{"key":"PLAN","stage":"PLAN","inputTokens":1000,"cachedInputTokens":250,"outputTokens":300,"costUsd":0.0001,"requests":1},'
      + '{"key":"WRITE","stage":"WRITE","inputTokens":2000,"cachedInputTokens":500,"outputTokens":600,"costUsd":1.1235,"requests":2}]');
    const bySubject = await call('/v1/staff/kb/costs', 200, { groupBy: 'SUBJECT,model' });
    expect(bySubject.json.map((r: any) => r.key)).toEqual(['61.12|anthropic-claude-haiku-4.5', '-|glm-5.3', '61.12|glm-5.3']);
    expect(Object.keys(bySubject.json[0])).toEqual(['key', 'model', 'subjectId', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'costUsd', 'requests']);
    const repriced = await call('/v1/staff/kb/costs', 200, { groupBy: 'model', reprice: 'true' });
    expect(repriced.json).toHaveLength(2);
    expect((await call('/v1/staff/kb/costs?groupBy=day', 400)).json.message)
      .toBe("Validation failed for field 'groupBy' with value 'day': must be one or more of [week, stage, model, subject]");
    expect((await call('/v1/staff/kb/costs?reprice=maybe', 400)).json.message).toBe("reprice: invalid boolean 'maybe'");
    const long = await call('/v1/staff/kb/costs?from=2024-01-01&to=2026-01-01', 400);
    expect(long.json.message).toBe("Validation failed for field 'from' with value '2024-01-01T00:00-03:00': the range may span at most 366 days");
    const after = await call('/v1/staff/kb/costs?from=2026-01-02&to=2026-01-01', 400);
    expect(after.json.message).toBe("Validation failed for field 'from' with value '2026-01-02': must not be after to");
    const garbage = await call('/v1/staff/kb/costs?from=nope', 400);
    expect(garbage.json.message).toBe("Validation failed for field 'from' with value 'nope': must be a date (YYYY-MM-DD) or an ISO datetime with offset (2026-07-11T00:00:00-03:00)");
  });

  test('summaryShape', async () => {
    const empty = await call('/v1/staff/kb/costs/summary', 200);
    expect(empty.text).toBe('{"last7dUsd":0.0000,"last30dUsd":0.0000,"projectedMonthUsd":0.0000,"byStage":{},"byModel":{},'
      + '"topSubjects":[],"cacheHitRatio":0.0,"simulated":false,"accuracy":{"lastRuns":[]}}');
    await usage('glm-5.3', 'WRITE', '61.12', '0.400000');
    await usage('glm-5.3-flash', 'DIGEST', '61.12', '0.100000', '10 days', false);
    await usage('glm-5.3', 'PLAN', null, '0.200000', '29 days', false);
    await api.db`INSERT INTO wiki.kb_run (id, status, trigger, started_at, finished_at, cost_estimate, expected_cost_usd)
                 VALUES ('00000000-0000-0000-0000-00000000000a', 'SUCCEEDED', 'SCHEDULED', '2026-10-01T03:00:00Z', '2026-10-01T04:00:00Z', 0.5, 0.45),
                        ('00000000-0000-0000-0000-00000000000b', 'FAILED', 'MANUAL', '2026-10-02T03:00:00Z', NULL, 0.1, NULL),
                        ('00000000-0000-0000-0000-00000000000c', 'SUCCEEDED', 'EVAL', '2026-10-03T03:00:00Z', NULL, 0.1, 0.1)`;
    const s = await call('/v1/staff/kb/costs/summary', 200);
    expect(s.text).toBe('{"last7dUsd":0.4000,"last30dUsd":0.7000,"projectedMonthUsd":0.5431,'
      + '"byStage":{"DIGEST":0.1000,"PLAN":0.2000,"WRITE":0.4000},"byModel":{"glm-5.3":0.6000,"glm-5.3-flash":0.1000},'
      + '"topSubjects":[{"subjectId":"61.12","subjectName":"Matemática Financiera","costUsd":0.5000}],'
      + '"cacheHitRatio":0.25,"simulated":true,'
      + '"accuracy":{"lastRuns":[{"runId":"00000000-0000-0000-0000-00000000000a","startedAt":"2026-10-01T03:00:00Z","trigger":"SCHEDULED","expectedUsd":0.4500,"actualUsd":0.5000}]}}');
  });

  test('quotaBeforeAnyDoCall', async () => {
    const q = await call('/v1/staff/kb/quota', 200);
    expect(q.text).toBe('{"observedAt":null,"batch":{"creationsPerHour":null,"createPerMinute":null,"requestsPerDay":null,"statusChecksPerMinute":null},'
      + '"sync":{"tokensPerDay":null,"tokensPerMinute":null,"requestsPerMinute":null},"stale":true}');
    expect((await call('/v1/staff/kb/quota?refresh=true', 200)).text).toBe(q.text);
    expect((await call('/v1/staff/kb/quota?refresh=x', 400)).json.message).toBe("refresh: invalid boolean 'x'");
  });
});
