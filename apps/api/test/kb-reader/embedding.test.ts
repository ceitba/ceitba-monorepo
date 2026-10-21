// In-process part of apps/api/src/test/java/org/ceitba/api/web/kb/KbEmbeddingIT.java:
// the tests that call KbEmbeddingService.embedPending()/search() directly (the
// FakeEmbeddingClient of KB_EMBEDDING_USE_FAKE). extensionAndIndexExist and the
// search endpoint are black-box: contract/tests/kb-reader-embedding.contract.test.ts;
// searchEndpointReturnsPassagesForReadersWithApuntes also runs here over the real sweep.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt } from '../../contract/support/identity';
import { FakeEmbeddingClient } from '../../src/external/llm';
import { DIMENSIONS } from '../../src/features/kb-reader/embeddingService';
import { kbReader } from '../../src/features/kb-reader/services';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let vanId = '';
let amortId = '';
const embeddings = () => kbReader(t.deps).embeddings;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

async function page(subject: string, slug: string, title: string, summary: string, markdown: string): Promise<string> {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO wiki.kb_page (id, subject_id, slug, type, title, summary, markdown, generator, generated_at)
    VALUES (${id}, ${subject}, ${slug}, 'CONCEPT', ${title}, ${summary}, ${markdown}, 'test', now())`;
  return id;
}

describe('KbEmbeddingIT (in process)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE wiki.kb_page, public.subject CASCADE`;
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
    vanId = await page('61.12', 'valor-actual-neto', 'Valor actual neto', 'Suma de flujos descontados.', `Intro.

## Cómo se calcula
Se descuentan los flujos de fondos a la tasa de corte y se restan de la inversión inicial.

## Criterio de decisión
Un proyecto conviene cuando el resultado es positivo.
`);
    amortId = await page('81.07', 'amortizaciones', 'Amortizaciones', 'Depreciación de bienes de uso.', `## Método de línea recta
El valor residual se reparte en cuotas iguales durante la vida útil del bien de uso.
`);
  });

  test('embedsPublishedPagesAndFindsTheMatchingSection', async () => {
    const sweep = await embeddings().embedPending();
    expect(sweep.embedded).toBe(2);
    expect(sweep.remaining).toBe(0);

    // Chunk 0 + 2 sections for the VAN page, chunk 0 + 1 section for the other.
    expect(Number((await t.sql`SELECT count(*)::int AS n FROM wiki.kb_page_chunk WHERE page_id = ${vanId}`)[0]!.n)).toBe(3);
    expect(Number((await t.sql`SELECT vector_dims(embedding) AS d FROM wiki.kb_page_chunk LIMIT 1`)[0]!.d)).toBe(DIMENSIONS);
    expect((await t.sql`SELECT DISTINCT model FROM wiki.kb_page_chunk`).map((r) => r.model)).toEqual([embeddings().model()]);

    const hits = await embeddings().search('cómo se descuentan los flujos de fondos con la tasa de corte', null, 3);
    expect(hits).toHaveLength(3);
    expect(hits[0]!.slug).toBe('valor-actual-neto');
    expect(hits[0]!.anchor).toBe('como-se-calcula');
    expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance);

    const scoped = await embeddings().search('vida útil del bien de uso', '81.07', 10);
    expect(scoped.length).toBeGreaterThan(0);
    for (const h of scoped) expect(h.subjectId).toBe('81.07');
    expect(scoped[0]!.anchor).toBe('metodo-de-linea-recta');

    // Nothing pending: a second sweep makes no requests.
    const client = t.deps.llm.embeddings as FakeEmbeddingClient;
    const calls = client.calls();
    expect((await embeddings().embedPending()).embedded).toBe(0);
    expect(client.calls()).toBe(calls);
  });

  test('searchEndpointReturnsPassagesForReadersWithApuntes', async () => {
    await embeddings().embedPending();
    const reader = { Authorization: `Bearer ${await mintJwt({ email: 'lector-kb@itba.edu.ar', name: 'Lector' })}` };
    await t.sql`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    let r = await t.request('GET', '/v1/wiki/kb/search?q=tasa%20de%20corte', { headers: reader });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('CAPABILITY_REQUIRED');
    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)`;
    try {
      r = await t.request('GET', `/v1/wiki/kb/search?q=${encodeURIComponent('cómo se descuentan los flujos de fondos')}&limit=2`, { headers: reader });
      expect(r.status).toBe(200);
      expect(r.json.results).toHaveLength(2);
      expect(r.json.results[0].slug).toBe('valor-actual-neto');
      expect(r.json.results[0].subjectId).toBe('61.12');
      expect(r.json.results[0].content).not.toBe('');
      expect(r.text).toMatch(/"score":0\.\d+[,}]/);
      r = await t.request('GET', '/v1/wiki/kb/search?q=bien%20de%20uso&subjectId=81.07', { headers: reader });
      expect(r.json.results[0].subjectId).toBe('81.07');
      expect((await t.request('GET', '/v1/wiki/kb/search?q=%20%20', { headers: reader })).status).toBe(400);
    } finally {
      await t.sql`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    }
  });

  test('aNewRevisionReplacesThePageChunks', async () => {
    await embeddings().embedPending();
    await t.sql`UPDATE wiki.kb_page SET markdown = ${'## Solo una sección\nTexto nuevo sobre la tasa interna de retorno.\n'}, revision = revision + 1 WHERE id = ${vanId}`;

    expect((await embeddings().embedPending()).embedded).toBe(1);
    expect((await t.sql`SELECT anchor FROM wiki.kb_page_chunk WHERE page_id = ${vanId} ORDER BY ordinal`).map((r) => r.anchor))
      .toEqual([null, 'solo-una-seccion']);
    expect((await t.sql`SELECT DISTINCT page_revision FROM wiki.kb_page_chunk WHERE page_id = ${vanId}`).map((r) => r.page_revision)).toEqual([2]);
  });

  test('hiddenPagesAreNeitherEmbeddedNorReturned', async () => {
    await t.sql`UPDATE wiki.kb_page SET status = 'HIDDEN', hidden_reason = 'STAFF' WHERE id = ${amortId}`;
    expect((await embeddings().embedPending()).embedded).toBe(1);

    // Restored: embedded now; hidden again: its chunks stay but are never returned.
    await t.sql`UPDATE wiki.kb_page SET status = 'PUBLISHED', hidden_reason = NULL WHERE id = ${amortId}`;
    expect((await embeddings().embedPending()).embedded).toBe(1);
    await t.sql`UPDATE wiki.kb_page SET status = 'HIDDEN', hidden_reason = 'STAFF' WHERE id = ${amortId}`;

    const hits = await embeddings().search('vida útil del bien de uso', null, 10);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.pageId).not.toBe(amortId);
  });
});
