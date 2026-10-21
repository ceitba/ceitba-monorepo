// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbKickIT.java (in process, see
// contract/IN-PROCESS.md): with the background on but every poller an hour away (and no
// scheduler running at all here), a new eval and a dry run advance right away (the kick
// of RunTriggered), without any tick. Through the staff routes (kb-admin's), like MockMvc.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff } from '../../contract/support/identity';
import { springPathRegExp } from '../../src/http/router';
import { InMemoryObjectStorage } from '../../src/infra/storage';
import { FakeSyncChatClient } from '../../src/features/kb/logic/external/fakeLlm';
import { kbPipeline } from '../../src/features/kb-pipeline/service';
import { testApp, type TestApp } from '../support/app';
import { responder, text } from './support';

let t: TestApp;
let staff: Record<string, string>;

beforeAll(async () => {
  t = await testApp({
    env: { KB_PIPELINE_BACKGROUND: 'true', KB_POLL_INTERVAL: 'PT1H', KB_BATCH_POLL_INTERVAL: 'PT1H', KB_EXECUTION_MODE: 'sync' },
    overrides: { storage: new InMemoryObjectStorage() },
  });
  await seedStaff(t.sql, 'staff@itba.edu.ar');
  staff = { Authorization: `Bearer ${await mintJwt({ email: 'staff@itba.edu.ar', name: 'Staff' })}` };
}, 60_000);
afterAll(async () => {
  await kbPipeline(t.deps).engine.stop();
  await t?.close();
});

const has = (method: string, path: string) => t.app.routes.some((r) => r.method === method && springPathRegExp(r.path).test(path));

async function call(method: string, path: string, body: unknown, expected: number): Promise<any> {
  const r = await t.request(method, path, { headers: staff, body });
  expect(r.status, r.text).toBe(expected);
  return r.json;
}

async function awaitDone(path: string): Promise<any> {
  let last: any = null;
  for (let i = 0; i < 150; i++) {
    last = await call('GET', path, undefined, 200);
    if (last.status === 'SUCCEEDED' || last.status === 'FAILED') return last;
    await Bun.sleep(100);
  }
  return last;
}

describe('KbKickIT', () => {
  test('evalAndDryRunAdvanceWithoutAPollerTick', async () => {
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now())`;
    const owner = crypto.randomUUID();
    await t.sql`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${owner}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    const source = crypto.randomUUID();
    await t.sql`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
      VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    await t.sql`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer,
        subject_id, effective_subject_id, publication, text_content, content_fingerprint)
      VALUES (${crypto.randomUUID()}, ${source}, 'd1', 'Guía.pdf', 'application/pdf', 'PDF', true, '61.12', '61.12', 'PUBLISHED',
        ${text('alfa')}, 'fp1')`;
    await t.sql`UPDATE wiki.kb_model SET last_probe = '{"ok":true,"mode":"sync"}'::jsonb`;
    const fake = t.deps.llm.chat as FakeSyncChatClient;
    fake.respond(responder(false));

    // The eval half needs kb-admin's eval routes (StaffKbEvalController).
    if (has('POST', '/v1/staff/kb/evals/sets')) {
      const set = await call('POST', '/v1/staff/kb/evals/sets', { name: 'Kick', subjectIds: ['61.12'] }, 201);
      const t0 = performance.now();
      const ev = await call('POST', '/v1/staff/kb/evals', { setId: set.id, models: [{ plan: 'glm-5.3', write: 'glm-5.3' }] }, 202);
      const done = await awaitDone('/v1/staff/kb/evals/' + ev.id);
      expect(done.status, JSON.stringify(done)).toBe('SUCCEEDED');
      expect(fake.received().length).toBeGreaterThan(0);
      expect((performance.now() - t0) / 1000).toBeLessThan(15);
    }

    const dry = await call('POST', '/v1/staff/kb/pipeline/runs?dryRun=true', undefined, 202);
    const finished = await awaitDone('/v1/staff/kb/pipeline/runs/' + dry.id);
    expect(finished.status, JSON.stringify(finished)).toBe('SUCCEEDED');
    expect(finished.stage).toBe('DONE');
    await kbPipeline(t.deps).engine.idle();
    const [n] = await t.sql`SELECT count(*)::int AS n FROM wiki.kb_run WHERE lease_owner IS NOT NULL`;
    expect(n!.n).toBe(0); // leases released
  }, 60_000);
});
