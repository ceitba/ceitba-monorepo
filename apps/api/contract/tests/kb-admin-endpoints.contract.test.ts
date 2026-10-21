// Custom OpenAI-compatible endpoints: apps/api/src/main/java/org/ceitba/api/web/kb/admin/StaffKbEndpointController.java
// (docs/SUBJECT-WIKI-ADMIN.md "Custom OpenAI-compatible endpoints"). No Java IT drives these
// routes over HTTP (KbCustomEndpointTest is a unit test, ported in test/kb/llm); this file is
// the black-box contract: CRUD, validation messages, the write-only key, test/discover against a
// local OpenAI-compatible server (Bun.serve in the test process), stats and the in-use check.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const STAFF = 'staff@itba.edu.ar';
const staff = async () => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));

let lastAuth: string | null = null;
const upstream = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    lastAuth = req.headers.get('authorization');
    if (url.pathname === '/v1/models') {
      return Response.json({ object: 'list', data: [{ id: 'Qwen/Qwen3-8B', object: 'model' }, { id: 'llama-3.1:8b', object: 'model' }] });
    }
    return new Response('nope', { status: 404 });
  },
});
afterAll(() => upstream.stop(true));
const BASE = `http://127.0.0.1:${upstream.port}/v1`;

async function call(method: 'get' | 'put' | 'post' | 'delete', path: string, body: unknown, expected: number) {
  const r = await api[method](path, { as: await staff(), body: body === null ? undefined : body });
  if (r.status !== expected) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;
const ISO_ART = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?-03:00$/;

describe('StaffKbEndpointController', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM wiki.kb_model WHERE id LIKE 'custom:%'`;
    await api.db`DELETE FROM wiki.kb_llm_endpoint`;
    await api.db`DELETE FROM wiki.kb_pipeline_settings`;
    if (!(await api.db`SELECT 1 FROM public."user" WHERE email = ${STAFF}`).length) await seedUser(api.db, STAFF, { name: 'Staff' });
    await seedStaff(api.db, STAFF);
  });

  test('createListUpdateWithAWriteOnlyKey', async () => {
    expect((await call('get', '/v1/staff/kb/endpoints', null, 200)).text).toBe('[]');
    const created = await call('post', '/v1/staff/kb/endpoints', { name: ' GPU-1 ', baseUrl: `${BASE}//`, apiKey: 'secreto', maxConcurrency: 3 }, 200);
    const e = created.json;
    expect(Object.keys(e)).toEqual(['id', 'name', 'baseUrl', 'hasKey', 'keyReadable', 'maxConcurrency', 'timeoutSec', 'enabled', 'modelCount', 'createdAt', 'updatedAt']);
    expect(e.name).toBe('gpu-1');
    expect(e.baseUrl).toBe(BASE);
    expect(e.hasKey).toBe(true);
    expect(e.keyReadable).toBe(true);
    expect(e.maxConcurrency).toBe(3);
    expect(e.timeoutSec).toBe(600);
    expect(e.enabled).toBe(true);
    expect(e.modelCount).toBe(0);
    expect(e.createdAt).toMatch(ISO_ART);
    expect(created.text).not.toContain('secreto');
    const [row] = await api.db`SELECT api_key_encrypted FROM wiki.kb_llm_endpoint WHERE id = ${e.id}`;
    expect(String(row!.api_key_encrypted)).toStartWith('v1:jwt:');

    const list = await call('get', '/v1/staff/kb/endpoints', null, 200);
    expect(list.json).toHaveLength(1);
    expect(list.json[0].createdAt).toMatch(ISO_Z);

    const dup = await call('post', '/v1/staff/kb/endpoints', { name: 'gpu-1', baseUrl: BASE }, 409);
    expect(dup.json.message).toBe("KbLlmEndpoint with identifier 'gpu-1' already exists");

    const upd = await call('put', `/v1/staff/kb/endpoints/${e.id}`, { apiKey: '', timeoutSec: 30, enabled: false, name: 'GPU-1' }, 200);
    expect(upd.json.hasKey).toBe(false);
    expect(upd.json.keyReadable).toBe(true);
    expect(upd.json.timeoutSec).toBe(30);
    expect(upd.json.enabled).toBe(false);
    expect(upd.json.createdAt).toMatch(ISO_Z);
    expect(upd.json.updatedAt).toMatch(ISO_ART);
    const keep = await call('put', `/v1/staff/kb/endpoints/${e.id}`, { maxConcurrency: 2 }, 200);
    expect(keep.json.hasKey).toBe(false);

    expect((await call('put', `/v1/staff/kb/endpoints/${e.id}`, { name: 'otro' }, 400)).json.message)
      .toBe("Validation failed for field 'name' with value 'otro': cannot be renamed (model ids custom:<name>:<slug> depend on it); create a new endpoint");
    expect((await call('put', `/v1/staff/kb/endpoints/${crypto.randomUUID()}`, {}, 404)).json.error).toBe('ResourceNotFound');
    expect((await call('put', '/v1/staff/kb/endpoints/nope', {}, 400)).json.message).toBe("id: invalid UUID 'nope'");
  });

  test('validationMessages', async () => {
    const cases: [unknown, string][] = [
      [{ name: 'Mal nombre', baseUrl: BASE }, "Validation failed for field 'name' with value 'mal nombre': required: lowercase letters, digits and '-' (max 47 chars)"],
      [{ baseUrl: BASE }, "Validation failed for field 'name' with value '': required: lowercase letters, digits and '-' (max 47 chars)"],
      [{ name: 'a', baseUrl: 'ftp://host/v1' }, "Validation failed for field 'baseUrl' with value 'ftp://host/v1': must be an http(s) URL with a host (e.g. http://host:8081/v1)"],
      [{ name: 'a', baseUrl: 'http://host/v1?x=1' }, "Validation failed for field 'baseUrl' with value 'http://host/v1?x=1': must be an http(s) URL with a host (e.g. http://host:8081/v1)"],
      [{ name: 'a', baseUrl: 'http://u:p@host/v1' }, "Validation failed for field 'baseUrl' with value 'http://u:p@host/v1': must be an http(s) URL with a host (e.g. http://host:8081/v1)"],
      [{ name: 'a', baseUrl: BASE, maxConcurrency: 0 }, "Validation failed for field 'maxConcurrency' with value '0': must be between 1 and 64"],
      [{ name: 'a', baseUrl: BASE, timeoutSec: 4000 }, "Validation failed for field 'timeoutSec' with value '4000': must be between 5 and 3600"],
      [{ name: 'a', baseUrl: BASE, enabled: 'yes' }, "Validation failed for field 'enabled' with value '\"yes\"': must be a boolean"],
      [{ name: 'a', baseUrl: BASE, apiKey: 5 }, "Validation failed for field 'apiKey' with value '(hidden)': must be a string"],
    ];
    for (const [body, message] of cases) {
      const r = await call('post', '/v1/staff/kb/endpoints', body, 400);
      expect(r.json.error).toBe('ValidationError');
      expect(r.json.message).toBe(message);
    }
  });

  test('testDiscoverStatsAndDelete', async () => {
    const e = (await call('post', '/v1/staff/kb/endpoints', { name: 'gpu', baseUrl: BASE, apiKey: 'tok' }, 200)).json;
    const t = await call('post', `/v1/staff/kb/endpoints/${e.id}/test`, null, 200);
    expect(Object.keys(t.json)).toEqual(['ok', 'latencyMs', 'models', 'error']);
    expect(t.json.ok).toBe(true);
    expect(t.json.models).toEqual(['Qwen/Qwen3-8B', 'llama-3.1:8b']);
    expect(t.json.error).toBeNull();
    expect(lastAuth).toBe('Bearer tok');

    const d = await call('post', `/v1/staff/kb/endpoints/${e.id}/discover`, null, 200);
    expect(d.text).toBe('{"added":["custom:gpu:Qwen-Qwen3-8B","custom:gpu:llama-3.1-8b"],"existing":[]}');
    const again = await call('post', `/v1/staff/kb/endpoints/${e.id}/discover`, null, 200);
    expect(again.text).toBe('{"added":[],"existing":["custom:gpu:Qwen-Qwen3-8B","custom:gpu:llama-3.1-8b"]}');
    const models = (await call('get', '/v1/staff/kb/models', null, 200)).json as any[];
    const qwen = models.find((m) => m.id === 'custom:gpu:Qwen-Qwen3-8B');
    expect(qwen.remoteModelId).toBe('Qwen/Qwen3-8B');
    expect(qwen.provider).toBe('custom');
    expect(qwen.enabled).toBe(false);
    expect(qwen.priceSource).toBe('custom');
    expect(qwen.inputPerM).toBe(0);
    expect(qwen.effectiveBatchModelId).toBeNull();
    expect((await call('get', '/v1/staff/kb/endpoints', null, 200)).json[0].modelCount).toBe(2);

    const s = await call('get', `/v1/staff/kb/endpoints/${e.id}/stats`, null, 200);
    expect(s.text).toBe('{"windowMinutes":60,"requests":0,"errors":0,"p50Ms":null,"p95Ms":null,"outputTokensPerSec":0.0,"inFlight":0}');
    await api.db`INSERT INTO wiki.kb_llm_usage (id, created_at, model, mode, stage, input_tokens, cached_input_tokens, output_tokens, cost_usd, latency_ms)
                 VALUES (gen_random_uuid(), now(), 'custom:gpu:Qwen-Qwen3-8B', 'SYNC', 'PLAN', 100, 0, 50, 0, 1000),
                        (gen_random_uuid(), now(), 'custom:gpu:Qwen-Qwen3-8B', 'SYNC', 'PLAN', 100, 0, 0, 0, 3000),
                        (gen_random_uuid(), now() - interval '2 hours', 'custom:gpu:llama-3.1-8b', 'SYNC', 'PLAN', 100, 0, 10, 0, 500)`;
    const s2 = await call('get', `/v1/staff/kb/endpoints/${e.id}/stats?minutes=30`, null, 200);
    expect(s2.text).toBe('{"windowMinutes":30,"requests":2,"errors":1,"p50Ms":2000,"p95Ms":2900,"outputTokensPerSec":12.5,"inFlight":0}');
    expect((await call('get', `/v1/staff/kb/endpoints/${e.id}/stats?minutes=0`, null, 400)).json.message)
      .toBe("Validation failed for field 'minutes' with value '0': must be between 1 and 10080");
    expect((await call('get', `/v1/staff/kb/endpoints/${e.id}/stats?minutes=x`, null, 400)).json.message)
      .toBe("minutes: invalid int 'x'");

    // In use by the settings: 409, nothing deleted.
    await api.db`INSERT INTO wiki.kb_pipeline_settings (id, settings, updated_at) VALUES (1, '{"modelPlan": "custom:gpu:Qwen-Qwen3-8B"}'::jsonb, now())`;
    const busy = await call('delete', `/v1/staff/kb/endpoints/${e.id}`, null, 409);
    expect(busy.json.error).toBe('KB_ENDPOINT_IN_USE');
    expect(busy.json.message).toBe('A model of this endpoint is used by the pipeline settings (custom:gpu:Qwen-Qwen3-8B)');
    await api.db`DELETE FROM wiki.kb_pipeline_settings`;
    const del = await call('delete', `/v1/staff/kb/endpoints/${e.id}`, null, 204);
    expect(del.text).toBe('');
    const [left] = await api.db`SELECT count(*)::int AS n FROM wiki.kb_model WHERE id LIKE 'custom:gpu:%'`;
    expect(left!.n).toBe(0);
    expect((await call('delete', `/v1/staff/kb/endpoints/${e.id}`, null, 404)).json.error).toBe('ResourceNotFound');
  });

  test('unreachableServer', async () => {
    const e = (await call('post', '/v1/staff/kb/endpoints', { name: 'off', baseUrl: 'http://127.0.0.1:9/v1', timeoutSec: 5 }, 200)).json;
    expect(e.hasKey).toBe(false);
    const t = await call('post', `/v1/staff/kb/endpoints/${e.id}/test`, null, 200);
    expect(t.json.ok).toBe(false);
    expect(t.json.models).toEqual([]);
    expect(typeof t.json.error).toBe('string');
    const d = await call('post', `/v1/staff/kb/endpoints/${e.id}/discover`, null, 502);
    expect(d.json.error).toBe('ExternalApiError');
    expect(d.json.message).toBe("External API error in custom endpoint 'off' during discover models (" + t.json.error + ')');
  });

  test('aTokenNobodyCanDecryptIsReportedNotUsed', async () => {
    const e = (await call('post', '/v1/staff/kb/endpoints', { name: 'rot', baseUrl: BASE, apiKey: 'tok' }, 200)).json;
    await api.db`UPDATE wiki.kb_llm_endpoint SET api_key_encrypted = 'v1:jwt:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' WHERE id = ${e.id}`;
    const item = (await call('get', '/v1/staff/kb/endpoints', null, 200)).json[0];
    expect(item.hasKey).toBe(true);
    expect(item.keyReadable).toBe(false);
    const t = await call('post', `/v1/staff/kb/endpoints/${e.id}/test`, null, 200);
    expect(t.text).toBe('{"ok":false,"latencyMs":0,"models":[],"error":"The stored token cannot be decrypted (AUTH_JWT_SECRET or KB_SECRETS_KEY changed): re-enter the token"}');
    const d = await call('post', `/v1/staff/kb/endpoints/${e.id}/discover`, null, 400);
    expect(d.json.message).toBe("Validation failed for field 'apiKey' with value '(hidden)': the stored token cannot be decrypted: re-enter the token");
  });
});
