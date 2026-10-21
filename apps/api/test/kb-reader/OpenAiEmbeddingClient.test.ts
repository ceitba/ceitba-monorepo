// external/llm/OpenAiEmbeddingClient against a local stub server (no Java test
// exists for it): request shape, retries (429/5xx/connection, Retry-After), no retry
// for 4xx or a timeout, and the index-ordered parse.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { LlmApiError } from '../../src/external/llm';
import { EmbeddingUnreachableError, OpenAiEmbeddingClient, createEmbeddingClient } from '../../src/external/llm/embedding';

type Reply = { status: number; body: string; headers?: Record<string, string>; delayMs?: number };
let replies: Reply[] = [];
const seen: { auth: string | null; body: any; path: string }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    seen.push({ auth: req.headers.get('authorization'), body: await req.json(), path: new URL(req.url).pathname });
    const r = replies.shift() ?? { status: 500, body: 'no reply scripted' };
    if (r.delayMs) await Bun.sleep(r.delayMs);
    return new Response(r.body, { status: r.status, headers: r.headers });
  },
});
afterAll(() => server.stop(true));

const base = `http://localhost:${server.port}/v1/`;
const sleeps: number[] = [];
const client = (key: string | null = null, timeoutMs = 5_000) =>
  new OpenAiEmbeddingClient(base, key, timeoutMs, { sleep: async (ms) => { sleeps.push(ms); } });
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify({ data }) });

describe('OpenAiEmbeddingClient', () => {
  beforeEach(() => { replies = []; seen.length = 0; sleeps.length = 0; });

  test('postsModelInputAndFloatEncodingAndOrdersByIndex', async () => {
    replies.push(ok([{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2.5] }]));
    const v = await client('sk-1').embed('m', ['a', 'b']);
    expect(v.map((x) => [...x])).toEqual([[1, 2.5], [3, 4]]);
    expect(seen[0]).toEqual({ auth: 'Bearer sk-1', body: { model: 'm', input: ['a', 'b'], encoding_format: 'float' }, path: '/v1/embeddings' });
  });

  test('aBlankKeySendsNoAuthorizationAndNoInputsMakeNoRequest', async () => {
    expect(await client('  ').embed('m', [])).toEqual([]);
    expect(seen).toHaveLength(0);
    replies.push(ok([{ index: 0, embedding: [1] }]));
    await client('  ').embed('m', ['a']);
    expect(seen[0]!.auth).toBeNull();
  });

  test('retries429And5xxHonouringRetryAfter', async () => {
    replies.push({ status: 429, body: 'slow down', headers: { 'Retry-After': ' 2 ' } }, { status: 503, body: 'busy' }, ok([{ index: 0, embedding: [1] }]));
    expect((await client().embed('m', ['a'])).length).toBe(1);
    expect(seen).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[1]).toBeLessThan(2250);
  });

  test('givesUpAfterFourAttempts', async () => {
    for (let i = 0; i < 4; i++) replies.push({ status: 500, body: 'x'.repeat(600) });
    const e = await client().embed('m', ['a']).catch((x) => x);
    expect(e).toBeInstanceOf(LlmApiError);
    expect(e).not.toBeInstanceOf(EmbeddingUnreachableError);
    expect(e.status).toBe(500);
    expect(e.message).toBe(`embeddings -> 500: ${'x'.repeat(500)}`);
    expect(seen).toHaveLength(4);
  });

  test('aClientErrorIsNotRetried', async () => {
    replies.push({ status: 404, body: 'no model' });
    const e = await client().embed('m', ['a']).catch((x) => x);
    expect(e.status).toBe(404);
    expect(e.message).toBe('embeddings -> 404: no model');
    expect(seen).toHaveLength(1);
  });

  test('aTimeoutIsUnreachableAndNotRetried', async () => {
    replies.push({ ...ok([{ index: 0, embedding: [1] }]), delayMs: 1500 });
    const e = await client(null, 1000).embed('m', ['a']).catch((x) => x);
    expect(e).toBeInstanceOf(EmbeddingUnreachableError);
    expect(e.message).toBe('embeddings -> 0: timed out after 1 s');
    expect(seen).toHaveLength(1);
  });

  test('aRefusedConnectionIsUnreachableAfterRetries', async () => {
    const dead = new OpenAiEmbeddingClient('http://127.0.0.1:1/v1', null, 2000, { sleep: async () => {} });
    const e = await dead.embed('m', ['a']).catch((x) => x);
    expect(e).toBeInstanceOf(EmbeddingUnreachableError);
    expect(e.status).toBe(0);
    expect(e.message.startsWith('embeddings -> 0: ')).toBe(true);
  });

  test('malformedAnswersAreLlmApiErrors', async () => {
    replies.push({ status: 200, body: 'not json' });
    expect((await client().embed('m', ['a']).catch((x) => x)).message).toStartWith('embeddings: malformed response: ');
    replies.push(ok([{ index: 3, embedding: [1] }]));
    expect((await client().embed('m', ['a']).catch((x) => x)).message).toBe('embeddings: malformed response item');
    replies.push(ok([{ index: 0, embedding: [1] }]));
    expect((await client().embed('m', ['a', 'b']).catch((x) => x)).message).toBe('embeddings: 1 vectors for 2 inputs');
  });

  test('selectionFollowsKbPipelineConfig', () => {
    const cfg = (e: Record<string, unknown>) => ({ kb: { embeddings: { useFake: false, baseUrl: '', apiKey: '', requestTimeoutMs: 1000, ...e } } }) as never;
    expect(createEmbeddingClient(cfg({ useFake: true })).constructor.name).toBe('FakeEmbeddingClient');
    expect(createEmbeddingClient(cfg({ baseUrl: '  ' })).constructor.name).toBe('UnconfiguredEmbeddingClient');
    expect(createEmbeddingClient(cfg({ baseUrl: 'http://x/v1/' })).constructor.name).toBe('OpenAiEmbeddingClient');
  });
});
