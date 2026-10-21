// Ports apps/api/src/test/java/org/ceitba/api/web/kb/KbEmbeddingIT.java, the parts a
// black-box server allows: extensionAndIndexExist and
// searchEndpointReturnsPassagesForReadersWithApuntes (GET /v1/wiki/kb/search).
// Deviation: the IT fills wiki.kb_page_chunk with KbEmbeddingService.embedPending()
// (the jar's KbEmbeddingJob starts a minute after boot and is off in tests); here the
// test writes the same rows itself (KbChunker + the default EmbeddingGemma document
// prompt + FakeEmbeddingClient's hashed bag of words, i.e. what the sweep stores with
// KB_EMBEDDING_USE_FAKE), so the search SQL, ranking and JSON are compared on both
// servers. The three tests that drive embedPending()/search() directly are in process:
// test/kb-reader/embedding.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEmbeddingClient } from '../../src/external/llm';
import { chunk } from '../../src/features/kb/logic/kbChunker';
import { KbEmbeddingProperties } from '../../src/features/kb-reader/embeddingProps';
import { literal } from '../../src/features/kb-reader/embeddingService';
import { bearer, mintJwt, useServer } from '../support';

const api = useServer();
const props = new KbEmbeddingProperties({});
const fake = new FakeEmbeddingClient(768);

let vanId = '';
let amortId = '';

async function page(subject: string, slug: string, title: string, summary: string, markdown: string): Promise<string> {
  const id = crypto.randomUUID();
  await api.db`INSERT INTO wiki.kb_page (id, subject_id, slug, type, title, summary, markdown, generator, generated_at)
    VALUES (${id}, ${subject}, ${slug}, 'CONCEPT', ${title}, ${summary}, ${markdown}, 'test', now())`;
  return id;
}

/** What KbEmbeddingService.embedPage writes for a PUBLISHED page (revision 1, the configured model). */
async function embed(pageId: string, title: string, summary: string, markdown: string) {
  const chunks = chunk(title, summary, markdown);
  const vectors = await fake.embed(props.model, chunks.map((c) => props.document(c.title, c.body)));
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    await api.db`INSERT INTO wiki.kb_page_chunk (page_id, page_revision, ordinal, heading, anchor, content, model, embedding)
      VALUES (${pageId}, 1, ${c.ordinal}, ${c.heading}, ${c.anchor}, ${c.text()}, ${props.model}, CAST(${literal(vectors[i]!)} AS vector))`;
  }
}

const VAN = ['Valor actual neto', 'Suma de flujos descontados.', `Intro.

## Cómo se calcula
Se descuentan los flujos de fondos a la tasa de corte y se restan de la inversión inicial.

## Criterio de decisión
Un proyecto conviene cuando el resultado es positivo.
`] as const;
const AMORT = ['Amortizaciones', 'Depreciación de bienes de uso.', `## Método de línea recta
El valor residual se reparte en cuotas iguales durante la vida útil del bien de uso.
`] as const;

describe('KbEmbeddingIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.kb_page, public.subject CASCADE`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
    vanId = await page('61.12', 'valor-actual-neto', ...VAN);
    amortId = await page('81.07', 'amortizaciones', ...AMORT);
  });

  test('extensionAndIndexExist', async () => {
    const [ext] = await api.db`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
    expect(String(ext!.extversion).trim()).not.toBe('');
    const [idx] = await api.db`SELECT indexdef FROM pg_indexes WHERE indexname = 'kb_page_chunk_embedding_idx'`;
    expect(idx!.indexdef).toContain('hnsw');
    expect(idx!.indexdef).toContain('vector_cosine_ops');
  });

  test('searchEndpointReturnsPassagesForReadersWithApuntes', async () => {
    await embed(vanId, ...VAN);
    await embed(amortId, ...AMORT);
    const reader = bearer(await mintJwt({ email: 'lector-kb@itba.edu.ar', name: 'Lector' }));

    await api.db`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    let r = await api.get('/v1/wiki/kb/search', { as: reader, query: { q: 'tasa de corte' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('CAPABILITY_REQUIRED');

    await api.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)`;
    try {
      r = await api.get('/v1/wiki/kb/search', { as: reader, query: { q: 'cómo se descuentan los flujos de fondos', limit: 2 } });
      expect(r.status).toBe(200);
      expect(r.json.results).toHaveLength(2);
      expect(r.json.results[0].slug).toBe('valor-actual-neto');
      expect(r.json.results[0].subjectId).toBe('61.12');
      expect(r.json.results[0].content).not.toBe('');
      r = await api.get('/v1/wiki/kb/search', { as: reader, query: { q: 'bien de uso', subjectId: '81.07' } });
      expect(r.status).toBe(200);
      expect(r.json.results[0].subjectId).toBe('81.07');
      expect((await api.get('/v1/wiki/kb/search', { as: reader, query: { q: '  ' } })).status).toBe(400);
    } finally {
      await api.db`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    }
  });
});
