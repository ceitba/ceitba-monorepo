// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/KbCustomEndpointTest.java
// A fake OpenAI-compatible server (llama.cpp-like, Bun.serve) stands in for the user's GPU.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { KbEndpointService } from '../../../src/features/kb/logic/admin/kbEndpointService';
import { FakeSyncChatClient } from '../../../src/features/kb/logic/external/fakeLlm';
import { UnconfiguredLlmBatchClient, UnconfiguredSyncChatClient } from '../../../src/features/kb/logic/external/unconfigured';
import { readTree } from '../../../src/features/kb/logic/jsonNode';
import { catalogId, KbEndpointRegistry } from '../../../src/features/kb/logic/llm/kbEndpointRegistry';
import { KbLlmRouter } from '../../../src/features/kb/logic/llm/kbLlmRouter';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { KbSecretCipher } from '../../../src/features/kb/logic/llm/kbSecretCipher';
import { SyncLlmExecutor, type LlmLine } from '../../../src/features/kb/logic/llm/syncLlmExecutor';
import { Odt } from '../../../src/features/kb/logic/odt';
import { noTx, type KbLlmEndpointStore, type KbModelStore } from '../../../src/features/kb/logic/ports';
import { KbLlmEndpoint, KbModel } from '../../../src/features/kb/logic/types';
import { InMemoryRepo } from '../support/inMemoryRepo';

const cipher = new KbSecretCipher('', 'test-jwt-secret');
const nowUtc = () => Odt.ofEpochMilli(Date.now());

let server: ReturnType<typeof Bun.serve>;
let inFlight = 0;
let peak = 0;
let bodies: string[] = [];
let auth: (string | null)[] = [];
let endpointRows: InMemoryRepo<KbLlmEndpoint, string>;
let modelRows: InMemoryRepo<KbModel, string>;
let registry: KbEndpointRegistry;

const findByName = (a: unknown[]) => endpointRows.all().find((e) => e.name === a[0]) ?? null;

describe('KbCustomEndpointTest', () => {
  beforeEach(() => {
    inFlight = 0;
    peak = 0;
    bodies = [];
    auth = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/v1/chat/completions') {
          bodies.push(await req.text());
          auth.push(req.headers.get('Authorization'));
          peak = Math.max(peak, ++inFlight);
          await Bun.sleep(200);
          inFlight--;
          return new Response(
            '{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\\"ok\\":true}"}}],\n' +
              ' "usage":{"prompt_tokens":10,"completion_tokens":5}}',
          );
        }
        if (url.pathname === '/v1/models') return new Response('{"data":[{"id":"qwen3.gguf"},{"id":"org/llama"}]}');
        return new Response('', { status: 404 });
      },
    });

    endpointRows = new InMemoryRepo<KbLlmEndpoint, string>((e) => e.id);
    const repo = endpointRows.on('findByName', findByName).as<KbLlmEndpointStore>();
    modelRows = new InMemoryRepo<KbModel, string>((m) => m.id);
    const endpoint = new KbLlmEndpoint('gpu', `http://127.0.0.1:${server.port}/v1`, null, nowUtc());
    endpoint.maxConcurrency = 2;
    endpoint.apiKeyEncrypted = cipher.encrypt('secret-token');
    endpointRows.rows.set(endpoint.id, endpoint);
    registry = new KbEndpointRegistry(repo, modelRows.as<KbModelStore>(), cipher);
  });

  afterEach(() => {
    server.stop(true);
  });

  test('customModelGoesToItsEndpointWithItsOwnConcurrency', async () => {
    // KB_SYNC_CONCURRENCY is 16, the endpoint allows 2: only 2 are ever in flight.
    const catalog = new KbModel('custom:gpu:my-model.gguf', 'my/model.gguf', 'custom', false, true);
    catalog.remoteModelId = 'my/model.gguf';
    modelRows.rows.set(catalog.id, catalog);
    const exec = new SyncLlmExecutor(new FakeSyncChatClient(), kbLlmProperties(null, 'k', 'sync', 16, false), null, registry);
    const lines: LlmLine[] = [];
    for (let i = 0; i < 6; i++) {
      lines.push({
        customId: 'c' + i,
        params: readTree(`{"model":"custom:gpu:my-model.gguf","max_tokens":100,"system":"s",
           "tools":[{"name":"submit_page","input_schema":{"type":"object"}}],
           "messages":[{"role":"user","content":"x"}]}`),
      });
    }
    let ok = 0;
    await exec.run(lines, (o) => {
      if (o.result.ok) ok++;
    }, () => false);
    expect(ok).toBe(6);
    expect(peak).toBe(2);
    expect(bodies).toHaveLength(6);
    for (const b of bodies) {
      expect(b).toContain('"model":"my/model.gguf"');
      expect(b).not.toContain('reasoning_effort');
    }
    for (const a of auth) expect(a).toBe('Bearer secret-token');
    expect(registry.inFlight(endpointRows.all()[0]!.id)).toBe(0);
  });

  test('discoverUpsertsCatalogIdsAndKeepsExistingOnes', async () => {
    const existing = new KbModel('custom:gpu:qwen3.gguf', 'mine', 'custom', false, true);
    existing.remoteModelId = 'qwen3.gguf';
    modelRows.rows.set(existing.id, existing);
    const service = new KbEndpointService(
      endpointRows.on('findByName', () => null).as<KbLlmEndpointStore>(),
      modelRows.as<KbModelStore>(),
      cipher,
      registry,
      nowUtc,
      noTx,
    );
    const res = await service.discover(endpointRows.all()[0]!.id);
    expect(res.added).toEqual(['custom:gpu:org-llama']);
    expect(res.existing).toEqual(['custom:gpu:qwen3.gguf']);
    const added = modelRows.rows.get('custom:gpu:org-llama')!;
    expect(added.provider).toBe('custom');
    expect(added.isBatchSupported()).toBe(false);
    expect(added.enabled).toBe(false);
    expect(added.inputPerM!.signum()).toBe(0);
    expect(modelRows.rows.get('custom:gpu:qwen3.gguf')!.enabled).toBe(true); // untouched
  });

  test('rawIdWithSlashGetsSlashFreeCatalogIdAndRoutesWithRawId', async () => {
    const service = new KbEndpointService(
      endpointRows.on('findByName', () => null).as<KbLlmEndpointStore>(),
      modelRows.as<KbModelStore>(),
      cipher,
      registry,
      nowUtc,
      noTx,
    );
    await service.discover(endpointRows.all()[0]!.id);
    const m = modelRows.rows.get('custom:gpu:org-llama')!;
    expect(m.remoteModelId).toBe('org/llama');
    for (const id of modelRows.rows.keys()) expect(id).not.toContain('/');
    // Same slug, different raw id: told apart by a hash; discovering again changes nothing.
    expect(catalogId('gpu', 'org llama', false)).toBe('custom:gpu:org-llama');
    const hashed = catalogId('gpu', 'org llama', true);
    expect(hashed.startsWith('custom:gpu:org-llama-')).toBe(true);
    expect(hashed).toHaveLength('custom:gpu:org-llama-'.length + 6);
    expect(catalogId('gpu', 'x'.repeat(300), true)).toHaveLength(128);
    expect((await service.discover(endpointRows.all()[0]!.id)).added).toEqual([]);

    // The service's stub hid findByName from the shared repo: restore it for the registry.
    endpointRows.on('findByName', findByName);
    const exec = new SyncLlmExecutor(new FakeSyncChatClient(), kbLlmProperties(null, 'k', 'sync', 16, false), null, registry);
    const line: LlmLine = {
      customId: 'c',
      params: readTree('{"model":"custom:gpu:org-llama","max_tokens":100,"system":"s","messages":[{"role":"user","content":"x"}]}'),
    };
    await exec.run([line], () => {}, () => false);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('"model":"org/llama"');
  });

  test('doKeyIsNeededOnlyWhenSomeStageModelIsNotCustom', () => {
    const router = new KbLlmRouter(new UnconfiguredLlmBatchClient(), new UnconfiguredSyncChatClient(), null, null);
    expect(router.availableFor(['custom:gpu:a', 'custom:gpu:b'])).toBe(true);
    expect(router.availableFor(['custom:gpu:a', 'glm-5'])).toBe(false);
  });
});
