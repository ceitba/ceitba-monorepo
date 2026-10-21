// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbEmbeddingServiceTest.java:
// the sweep's error handling. A page-level failure skips that page; a configuration
// error (auth, unknown model, wrong vector length) ends the sweep at once.
// Mockito mocks become an in-memory store and a scripted client.
import { beforeEach, describe, expect, test } from 'bun:test';
import { LlmApiError, type EmbeddingClient } from '../../src/external/llm';
import { EmbeddingUnreachableError } from '../../src/external/llm/embedding';
import { KbEmbeddingProperties } from '../../src/features/kb-reader/embeddingProps';
import {
  KbEmbeddingService, endpointProblem, literal, type EmbeddingStore, type StoreTx,
} from '../../src/features/kb-reader/embeddingService';

const a = crypto.randomUUID();
const b = crypto.randomUUID();

let embedCalls = 0;
let inserts = 0;
let answer: (inputs: string[], call: number) => Float32Array[];
let service: KbEmbeddingService;

const store: EmbeddingStore = {
  findPageIdsToEmbed: async () => [a, b],
  countPagesToEmbed: async () => 0,
  findPage: async (id) => ({ id, status: 'PUBLISHED', revision: 1, title: 'VAN', summary: 'Resumen.', markdown: '## Uno\nTexto.\n' }),
  deleteChunks: async () => {},
  insertChunk: async () => { inserts++; },
  enableIterativeScan: async () => {},
  findNearest: async () => [],
};
const noTx: StoreTx = (fn) => fn(store);
const client: EmbeddingClient = {
  available: () => true,
  embed: async (_m, inputs) => answer(inputs, ++embedCalls),
};
const quiet = { warn() {}, info() {} };

describe('KbEmbeddingServiceTest', () => {
  beforeEach(() => {
    embedCalls = 0;
    inserts = 0;
    service = new KbEmbeddingService(client, new KbEmbeddingProperties({ baseUrl: 'http://embeddings/v1' }), noTx, quiet);
  });

  test('anUnreachableServerStopsTheSweepAfterOneRequest', async () => {
    answer = () => { throw new EmbeddingUnreachableError('embeddings -> 0: refused'); };
    expect((await service.embedPending()).failed).toBe(1);
    expect(embedCalls).toBe(1);
  });

  test('aMalformedAnswerForOnePageDoesNotStopTheOthers', async () => {
    answer = (inputs, call) => {
      if (call === 1) throw new LlmApiError(0, 'embeddings: malformed response');
      return inputs.map(() => new Float32Array(768));
    };
    const r = await service.embedPending();
    expect(r.failed).toBe(1);
    expect(embedCalls).toBe(2);
  });

  test('anUnknownModelStopsTheSweepAfterOneRequest', async () => {
    answer = () => { throw new LlmApiError(404, 'embeddings -> 404: no model'); };
    const r = await service.embedPending();
    expect(r.embedded).toBe(0);
    expect(r.failed).toBe(1);
    expect(embedCalls).toBe(1);
  });

  test('aWrongVectorLengthStopsTheSweep', async () => {
    answer = (inputs) => inputs.map(() => new Float32Array(1024));
    expect((await service.embedPending()).failed).toBe(1);
    expect(embedCalls).toBe(1);
    expect(inserts).toBe(0);
  });

  test('aPageLevelErrorSkipsOnlyThatPage', async () => {
    answer = () => { throw new LlmApiError(400, 'embeddings -> 400: input'); };
    const r = await service.embedPending();
    expect(r.failed).toBe(2);
    expect(embedCalls).toBe(2);
  });
});

describe('KbEmbeddingService helpers', () => {
  test('endpointProblemClassifiesStatuses', () => {
    for (const s of [401, 403, 404]) expect(endpointProblem(new LlmApiError(s, 'x'))).toBe(true);
    for (const s of [0, 400, 429, 500]) expect(endpointProblem(new LlmApiError(s, 'x'))).toBe(false);
    expect(endpointProblem(new EmbeddingUnreachableError('x'))).toBe(true);
  });

  test('literalUsesFloatToStringDigits', () => {
    expect(literal(new Float32Array([0.1, 1, 0, -2.5, 1e-7]))).toBe('[0.1,1.0,0.0,-2.5,1.0E-7]');
    expect(() => literal([Number.NaN])).toThrow('embeddings: non-finite value in vector');
  });

  test('unavailableClientMakesTheSweepANoOpAndSearchA501', async () => {
    const off = new KbEmbeddingService({ available: () => false, embed: async () => [] }, new KbEmbeddingProperties({}), noTx, quiet);
    expect(await off.embedPending()).toEqual({ embedded: 0, failed: 0, remaining: 0 });
    await expect(off.search('x', null, 3)).rejects.toMatchObject({ status: 501, code: 'NotImplemented' });
  });

  test('propertiesNormalizeLikeTheRecordConstructor', () => {
    const p = new KbEmbeddingProperties({ baseUrl: ' http://e/v1// ', model: '  ', queryTemplate: '', documentTemplate: ' ', batchSize: 0, requestTimeoutMs: 0 });
    expect(p.baseUrl).toBe('http://e/v1');
    expect(p.model).toBe('embeddinggemma-2');
    expect(p.batchSize).toBe(16);
    expect(p.requestTimeoutMs).toBe(120_000);
    expect(p.query('a $& b')).toBe('task: search result | query: a $& b');
    expect(p.document('T {text}', '$$x$$')).toBe('title: T $$x$$ | text: $$x$$');
  });
});
