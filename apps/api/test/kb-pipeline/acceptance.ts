// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbPipelineAcceptanceIT.java: the
// pipeline acceptance tests, run against both executors (BatchPipelineIT.test.ts,
// SyncPipelineIT.test.ts). The stored JSONL payloads are the same in both modes, so
// every assertion reads them.

import { expect, test } from 'bun:test';
import type { JsonValue } from '../../src/features/kb/logic/jsonNode';
import { Acceptance, CONT, FIN, responder, text } from './support';

export function acceptanceTests(a: Acceptance, expectedMode: 'BATCH' | 'SYNC'): void {
  test('noChangesMeansZeroRequests', async () => {
    expect((await a.run()).status).toBe('SUCCEEDED');
    const base = a.json(await a.kb().pipeline.baseline());
    expect(JSON.stringify(base.subjects)).toContain(FIN);
    expect(JSON.stringify(base.subjects)).toContain(CONT);
    a.fakeBatch().reset();
    a.fakeSync().reset();
    const rows = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request`);
    const usage = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_llm_usage`);
    const run = await a.run();
    expect(run.status).toBe('SUCCEEDED');
    expect(a.llmRequests()).toHaveLength(0);
    expect(a.payloadKeys(run.id)).toHaveLength(0);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request`)).toBe(rows);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_llm_usage`)).toBe(usage);
    expect(JSON.stringify(a.json(await a.kb().pipeline.preview()))).not.toContain(FIN);
  });

  test('firstRunPublishesThenOnlyTheChangedFileIsSent', async () => {
    const first = await a.run();
    expect(first.status, JSON.stringify(first)).toBe('SUCCEEDED');
    expect(new Set(await a.modes(first.id))).toEqual(new Set([expectedMode]));
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
    expect(await a.publishedSlugs(CONT)).toEqual(['conceptos-centrales']);
    expect(first.costUsd).toBeGreaterThan(0);
    expect(first.simulated).toBe(true);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_llm_usage WHERE simulated`)).toBeGreaterThan(0);

    // Nothing changed: zero requests.
    const before = a.llmRequests().length;
    const idle = await a.run();
    expect(idle.status).toBe('SUCCEEDED');
    expect(a.llmRequests()).toHaveLength(before);
    expect(a.payloadKeys(idle.id)).toHaveLength(0);

    // One file of 61.12 changes.
    await a.changeText(a.f2, text('delta'));
    const second = await a.run();
    const id = second.id;
    expect(second.status, JSON.stringify(second)).toBe('SUCCEEDED');
    expect(new Set(await a.modes(id))).toEqual(new Set([expectedMode]));
    const payloads = a.stored(id);
    expect(payloads).toContain('deltapalabra1 ');
    // Raw text of unchanged files never appears in any stored payload.
    for (const t of ['alfapalabra1 ', 'gammapalabra1 ', 'betapalabra1 ']) expect(payloads).not.toContain(t);
    const subjects = (await a.sql`SELECT subject_id FROM wiki.kb_run_subject WHERE run_id = ${id}::uuid`).map((r) => r.subject_id);
    expect(subjects).toEqual([FIN]);
    // Same page updated, not duplicated.
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
  });

  test('digestsAreReusedByFingerprint', async () => {
    await a.run();
    const digests = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_file_digest`);
    // A new file with the same content as f3 (another subject): no DIGEST request.
    await a.file('Copia.pdf', FIN, text('gamma'));
    const again = await a.run();
    const stages = (await a.sql`SELECT DISTINCT stage FROM wiki.kb_run_request WHERE run_id = ${again.id}::uuid`).map((r) => r.stage);
    expect(stages).not.toContain('DIGEST');
    expect(stages).toContain('PLAN');
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_file_digest`)).toBe(digests);
  });

  test('rejectedPagesGetOneRetry', async () => {
    a.respond(responder(true));
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('SUCCEEDED');
    const stages = (await a.sql`SELECT DISTINCT stage FROM wiki.kb_run_request WHERE run_id = ${run.id}::uuid`).map((r) => r.stage);
    expect(stages).toContain('WRITE');
    expect(stages).toContain('RETRY');
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
  });

  // A budget nothing fits in: the smallest subject runs alone (dedicated run), the
  // other is deferred without being digested and stays dirty.
  test('budgetAdmitsTheOversizedSubjectAloneAndDefersTheRest', async () => {
    // PUT /v1/staff/kb/settings {"runTokenBudget": 1} (the settings row it writes).
    await a.sql`INSERT INTO wiki.kb_pipeline_settings (id, settings, updated_at) VALUES (1, '{"runTokenBudget": 1}'::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`;
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('PARTIAL'); // deferred: not a clean run
    const statuses = (await a.sql`SELECT status FROM wiki.kb_run_subject WHERE run_id = ${run.id}::uuid ORDER BY status`)
      .map((r) => r.status);
    expect(statuses).toEqual(['DEFERRED', 'PUBLISHED']);
    const [reason] = await a.sql`SELECT error FROM wiki.kb_run_subject WHERE run_id = ${run.id}::uuid AND status = 'DEFERRED'`;
    expect(String(reason!.error).startsWith('presupuesto de la corrida')).toBe(true);
    expect(run.budget.admitted).toBe(1);
    expect(run.budget.deferred).toBe(1);
    expect(run.budget.oversizedSubjectId).not.toBeNull();
    expect(run.error).toContain('1 materia completada');
    expect(run.error).toContain('1 diferida por presupuesto');
    const preview = JSON.stringify(a.json(await a.kb().pipeline.preview()));
    expect(preview.includes(FIN) || preview.includes(CONT)).toBe(true);
  });

  test('removedSoleSourceDeletesThePageWithoutRequests', async () => {
    await a.run();
    const before = a.llmRequests().length;
    await a.sql`UPDATE wiki.drive_file SET publication = 'REMOVED_BY_STAFF' WHERE id = ${a.f3}`;
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('SUCCEEDED');
    expect(await a.publishedSlugs(CONT)).toEqual([]);
    expect(a.llmRequests()).toHaveLength(before);
  });

  test('costByStageAndUsageRows', async () => {
    const run = await a.run();
    expect(run.costByStage).toHaveProperty('WRITE');
    const stages = (await a.sql`SELECT DISTINCT stage FROM wiki.kb_llm_usage`).map((r) => r.stage);
    for (const s of ['DIGEST', 'PLAN', 'WRITE']) expect(stages).toContain(s);
    const summary = a.json(await a.kb().costs.summary());
    expect(summary.simulated).toBe(true);
    expect(summary.accuracy.lastRuns.length).toBeGreaterThan(0);
    const last = summary.accuracy.lastRuns[0];
    expect(last.trigger).toBe('MANUAL');
    expect(last.startedAt != null && 'expectedUsd' in last && 'actualUsd' in last).toBe(true);
  });

  // One subject whose PLAN is unusable fails alone (and stays dirty): the other
  // publishes and the run is PARTIAL, with the counts in its error.
  test('aFailingSubjectDoesNotStopTheOthers', async () => {
    const base = responder(false);
    const badPlan: JsonValue = {
      operations: [{ op: 'create', slug: 'x', type: 'concept', title: 'X', reason: 'r', sources: ['not-a-file'] }],
    };
    a.respond((r) => (r.toolName === 'submit_plan' && r.userText.includes('Matemática Financiera') ? badPlan : base(r)));
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('PARTIAL');
    expect(run.error).toContain('1 materia con fallas');
    const [row] = await a.sql`SELECT error FROM wiki.kb_run WHERE id = ${run.id}::uuid`;
    expect(String(row!.error)).toContain('1 materia con fallas');
    expect(await a.publishedSlugs(FIN)).toEqual([]);
    expect(await a.publishedSlugs(CONT)).toEqual(['conceptos-centrales']);
    const [st] = await a.sql`SELECT status FROM wiki.kb_run_subject WHERE subject_id = ${FIN}`;
    expect(st!.status).toBe('FAILED');
  });

  // A file nobody could digest (1 of 5, under the 20% ratio) is left out: the subject
  // publishes with the rest, notes it, and the file is not recorded as compiled so
  // the next run retries it.
  test('aSubjectGoesOnWithoutOneUnreadFile', async () => {
    for (const tag of ['uno', 'dos', 'tres']) await a.file(`Extra ${tag}.pdf`, FIN, text(tag));
    const base = responder(false);
    a.respond((r) => (r.toolName === 'submit_digest' && r.userText.includes('betapalabra1 ') ? null : base(r)));
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('PARTIAL');
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
    const [sk] = await a.sql`SELECT jsonb_array_length(skipped) AS n FROM wiki.kb_run_subject
      WHERE run_id = ${run.id}::uuid AND subject_id = ${FIN}`;
    expect(Number(sk!.n)).toBe(1);
    const [er] = await a.sql`SELECT error FROM wiki.kb_run_subject WHERE run_id = ${run.id}::uuid AND subject_id = ${FIN}`;
    expect(String(er!.error)).toContain('archivo sin resumen; se reintentan en la próxima corrida');
    const [compiled] = await a.sql`SELECT inputs::text AS inputs FROM wiki.kb_subject_state WHERE subject_id = ${FIN}`;
    expect(String(compiled!.inputs)).not.toContain(a.f2);
    // Next run: only that file is dirty again.
    a.respond(responder(false));
    const again = await a.run();
    expect(again.status, JSON.stringify(again)).toBe('SUCCEEDED');
  });
}
