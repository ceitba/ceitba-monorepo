// TS-only checks of the real DigitalOcean clients (no Java test drives them: the ITs use the
// fakes): src/external/llm/doBatchClient.ts (DoBatchClient.java), doModelCatalog.ts
// (HttpDoModelCatalog.java) and the selection in createLlmClients (KbPipelineConfig.java).

import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../src/config';
import { CONTRACT_ENV } from '../../contract/support/env';
import { createLlmClients } from '../../src/external/llm';
import { DoBatchClient } from '../../src/external/llm/doBatchClient';
import { HttpDoModelCatalog } from '../../src/external/llm/doModelCatalog';
import { DoChatClient } from '../../src/features/kb/logic/external/doChatClient';
import { DoQuotaTracker } from '../../src/features/kb/logic/external/doQuotaTracker';
import { FakeLlmBatchClient, FakeSyncChatClient } from '../../src/features/kb/logic/external/fakeLlm';
import { LlmApiError } from '../../src/features/kb/logic/external/llmApi';
import { UnconfiguredLlmBatchClient, UnconfiguredSyncChatClient } from '../../src/features/kb/logic/external/unconfigured';
import { Odt } from '../../src/features/kb/logic/odt';

interface Call { method: string; url: string; headers: Record<string, string>; body: string | null }

function fakeFetch(handler: (c: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    const body = init?.body == null ? null : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array);
    const c = { method: init?.method ?? 'GET', url: String(input), headers: h, body };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('DoBatchClient (HTTP)', () => {
  test('createsUploadsSubmitsPollsAndDownloadsWithTheBearerKey', async () => {
    const quota = new DoQuotaTracker(() => Odt.parse('2026-10-20T12:00:00Z'));
    const { fetch, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/v1/batches/files')) return json({ file_id: 'f1', upload_url: 'https://upload.test/f1' });
      if (c.url === 'https://upload.test/f1') return new Response('', { status: 200 });
      if (c.url.endsWith('/v1/batches') && c.method === 'POST') {
        return json({ batch_id: 'b1', status: 'validating' }, 200, { 'x-ratelimit-limit-batch-creations-per-hour': '5', 'x-ratelimit-remaining-batch-creations-per-hour': '4' });
      }
      if (c.url.endsWith('/v1/batches/b1')) return json({ batch_id: 'b1', status: 'completed', result_available: true, request_counts: { total: 1 } });
      if (c.url.endsWith('/v1/batches/b1/results')) return json({ result_available: true, download: { presigned_url: 'https://dl.test/out' } });
      if (c.url === 'https://dl.test/out') return new Response('{"custom_id":"x"}\n');
      if (c.url.endsWith('/v1/batches') && c.method === 'GET') return json({ edges: [{ node: { id: 'b1', request_id: 'r1', status: 'completed' } }] });
      return json({}, 404);
    });
    const client = new DoBatchClient('https://inference.test/', 'key-1', { quota, fetch });
    const file = await client.createFile('kb/runs/x/digest.jsonl');
    expect(file).toEqual({ fileId: 'f1', uploadUrl: 'https://upload.test/f1' });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ file_name: 'kb-runs-x-digest.jsonl' });
    expect(calls[0]!.headers.authorization).toBe('Bearer key-1');
    await client.upload(file.uploadUrl, new TextEncoder().encode('{"a":1}\n'));
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.headers.authorization).toBeUndefined();
    expect(calls[1]!.body).toBe('{"a":1}\n');
    const created = await client.createBatch('f1', 'r1', 'anthropic', null);
    expect(created.id).toBe('b1');
    expect(JSON.parse(calls[2]!.body!)).toEqual({ file_id: 'f1', provider: 'anthropic', completion_window: '24h', request_id: 'r1' });
    expect(quota.counter('batch-creations-per-hour')?.remaining).toBe(4);
    const polled = await client.get('b1');
    expect(polled.finished()).toBe(true);
    const results = await client.results('b1');
    expect(results).toEqual({ available: true, outputFileUrl: 'https://dl.test/out', errorFileUrl: null });
    expect(new TextDecoder().decode(await client.download(results.outputFileUrl!))).toBe('{"custom_id":"x"}\n');
    expect((await client.findByRequestId('r1'))?.id).toBe('b1');
    expect(await client.findByRequestId('other')).toBeNull();
  });

  test('errorsCarryTheStatusAndTheCutBody', async () => {
    const { fetch } = fakeFetch(() => new Response('x'.repeat(600), { status: 429 }));
    const client = new DoBatchClient('https://inference.test', 'k', { fetch });
    const e = await client.get('b1').catch((x) => x);
    expect(e).toBeInstanceOf(LlmApiError);
    expect(e.status).toBe(429);
    expect(e.message).toBe(`GET /v1/batches/b1 -> 429: ${'x'.repeat(500)}...`);
    const down = new DoBatchClient('https://inference.test', 'k', { fetch: (async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch });
    const e2 = await down.cancel('b1').catch((x) => x);
    expect(e2.status).toBe(0);
    expect(e2.message).toBe('POST /v1/batches/b1/cancel: connection refused');
  });
});

describe('HttpDoModelCatalog', () => {
  test('followsTheNextLinks', async () => {
    const { fetch, calls } = fakeFetch((c) => (c.url.endsWith('?page=2')
      ? json({ data: [{ id: 'b' }], links: { pages: {} } })
      : json({ data: [{ id: 'a' }], links: { pages: { next: 'https://catalog.test/x?page=2' } } })));
    const items = await new HttpDoModelCatalog(fetch, 'https://catalog.test/x').fetch();
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls[0]!.url).toBe('https://catalog.test/x?per_page=200');
  });

  test('aFailedPageIsAnLlmApiError', async () => {
    const { fetch } = fakeFetch(() => json({}, 503));
    const e = await new HttpDoModelCatalog(fetch).fetch().catch((x) => x);
    expect(e).toBeInstanceOf(LlmApiError);
    expect(e.message).toBe('DO model catalog -> 503');
  });
});

describe('createLlmClients (KbPipelineConfig)', () => {
  test('fakesUnconfiguredOrDigitalOcean', async () => {
    const fake = createLlmClients(await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x' }));
    expect(fake.batch).toBeInstanceOf(FakeLlmBatchClient);
    expect(fake.chat).toBeInstanceOf(FakeSyncChatClient);
    const none = createLlmClients(await loadConfig({ ...CONTRACT_ENV, KB_LLM_USE_FAKE: 'false', DATABASE_URL: 'jdbc:postgresql://localhost:1/x' }));
    expect(none.batch).toBeInstanceOf(UnconfiguredLlmBatchClient);
    expect(none.chat).toBeInstanceOf(UnconfiguredSyncChatClient);
    expect(none.catalog).toBeInstanceOf(HttpDoModelCatalog);
    const real = createLlmClients(await loadConfig({ ...CONTRACT_ENV, KB_LLM_USE_FAKE: 'false', KB_LLM_API_KEY: 'k', DATABASE_URL: 'jdbc:postgresql://localhost:1/x' }));
    expect(real.batch).toBeInstanceOf(DoBatchClient);
    expect(real.chat).toBeInstanceOf(DoChatClient);
    expect(real.quota).toBeInstanceOf(DoQuotaTracker);
  });
});
