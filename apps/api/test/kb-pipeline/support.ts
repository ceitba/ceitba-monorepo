// Shared harness of the pipeline acceptance ports:
// apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbPipelineAcceptanceIT.java (seed, run(),
// stored(), payloadKeys(), modes(), publishedSlugs()) and KbFakeAnswers.java (the scripted
// structured answers). The Java ITs drive the staff endpoints through MockMvc and the
// engine directly; here the same calls go to kbPipeline(deps) in process (the routes
// are kb-admin's; their HTTP contract is covered there).

import { toJavaJson } from '../../src/lib/json';
import { InMemoryObjectStorage } from '../../src/infra/storage';
import { FakeLlmBatchClient, FakeSyncChatClient, type FakeLlmRequest, type Responder } from '../../src/features/kb/logic/external/fakeLlm';
import { jHashCode } from '../../src/features/kb/logic/javaString';
import type { JsonValue } from '../../src/features/kb/logic/jsonNode';
import { kbPipeline, type KbPipeline } from '../../src/features/kb-pipeline/service';
import type { DepsOverrides } from '../../src/deps';
import { testApp, type TestApp } from '../support/app';

export const FIN = '61.12';
export const CONT = '81.07';

const FILE_ID = /"fileId"\s*:\s*"([0-9a-f-]{36})"/g;

/** KbFakeAnswers.ids: the distinct file ids named in a request, in order. */
export function ids(text: string | null): string[] {
  const out = new Set<string>();
  for (const m of (text ?? '').matchAll(FILE_ID)) out.add(m[1]!);
  return [...out];
}

/**
 * KbFakeAnswers.responder: a digest, a plan with one concept page per subject citing
 * every changed file, and a page body that passes validation (or, with
 * badFirstWrite, a WRITE without citations that only the RETRY fixes).
 */
export function responder(badFirstWrite: boolean): Responder {
  return (r: FakeLlmRequest): JsonValue | null => {
    const found = ids(r.userText);
    switch (r.toolName) {
      case 'submit_digest':
        return { topics: [{ name: 'Interés compuesto', summary: 'Capitalización de intereses período a período.' }] };
      case 'submit_plan':
        return {
          operations: [{ op: 'create', slug: 'conceptos-centrales', type: 'concept', title: 'Conceptos centrales', sources: found, reason: 'material nuevo' }],
        };
      case 'submit_page': {
        const retry = r.userText.includes('"errors"');
        const cite = found.length === 0 ? '' : ` [[file:${found[0]}]]`;
        return {
          markdown: '## Resumen\n\nUna explicación breve con palabras propias sobre la idea principal del material de la cursada.'
            + (badFirstWrite && !retry ? '' : cite) + '\n',
        };
      }
      default:
        return null;
    }
  };
}

/** Unique words per file, so payloads can be searched for them. */
export function text(tag: string): string {
  return Array.from({ length: 80 }, (_, i) => `${tag}palabra${i}`).join(' ');
}

export class Acceptance {
  t!: TestApp;
  storage = new InMemoryObjectStorage();
  source = '';
  f1 = '';
  f2 = '';
  f3 = '';

  constructor(private readonly env: Record<string, string> = {}, private readonly overrides: DepsOverrides = {}) {}

  async start(): Promise<void> {
    this.t = await testApp({ env: this.env, overrides: { storage: this.storage, ...this.overrides } });
  }

  async close(): Promise<void> {
    await this.kb().engine.idle();
    await this.t?.close();
  }

  kb(): KbPipeline {
    return kbPipeline(this.t.deps);
  }

  get sql() {
    return this.t.sql;
  }

  fakeBatch(): FakeLlmBatchClient {
    return this.t.deps.llm.batch as FakeLlmBatchClient;
  }

  fakeSync(): FakeSyncChatClient {
    return this.t.deps.llm.chat as FakeSyncChatClient;
  }

  respond(r: Responder): void {
    this.fakeBatch().respond(r);
    this.fakeSync().respond(r);
  }

  llmRequests(): FakeLlmRequest[] {
    return [...this.fakeBatch().submitted(), ...this.fakeSync().received()];
  }

  /** @BeforeEach seed(). */
  async seed(): Promise<void> {
    const sql = this.sql;
    await sql`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, wiki.kb_run CASCADE`;
    await sql`TRUNCATE wiki.kb_file_digest, wiki.kb_subject_state, wiki.kb_llm_usage, wiki.kb_pipeline_settings,
      wiki.kb_pipeline_settings_history CASCADE`;
    await sql`TRUNCATE public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
    await sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
    const owner = crypto.randomUUID();
    await sql`INSERT INTO public."user" (id, email, name, created_at, updated_at)
      VALUES (${owner}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    this.source = crypto.randomUUID();
    await sql`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
      VALUES (${this.source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    this.f1 = await this.file('Guía VTD.pdf', FIN, text('alfa'));
    this.f2 = await this.file('Resumen TIR.pdf', FIN, text('beta'));
    this.f3 = await this.file('Balance.pdf', CONT, text('gamma'));
    this.storage.clear();
    this.fakeBatch().reset();
    this.fakeSync().reset();
    this.respond(responder(false));
  }

  async file(name: string, subject: string, content: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer,
        subject_id, effective_subject_id, publication, text_content, content_fingerprint)
      VALUES (${id}, ${this.source}, ${'d-' + id}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, 'PUBLISHED',
        ${content}, ${'fp-' + jHashCode(content)})`;
    return id;
  }

  async changeText(id: string, content: string): Promise<void> {
    await this.sql`UPDATE wiki.drive_file SET text_content = ${content}, content_fingerprint = ${'fp-' + jHashCode(content)}
      WHERE id = ${id}`;
  }

  /** A DTO as the client sees it (Jackson bytes, parsed). */
  json<T = any>(v: unknown): T {
    return JSON.parse(toJavaJson(v)) as T;
  }

  /** POST /runs, engine.advanceActive(), GET /runs/{id}. */
  async run(): Promise<any> {
    const started = await this.kb().pipeline.trigger('MANUAL', false);
    await this.kb().engine.advanceActive();
    return this.json(await this.kb().pipeline.run(started.id));
  }

  async get(id: string): Promise<any> {
    return this.json(await this.kb().pipeline.run(id));
  }

  /** Every stored JSONL (payloads and outputs) of a run, concatenated. */
  stored(runId: string): string {
    let sb = '';
    for (const k of this.storage.keys()) if (k.startsWith(`kb/runs/${runId}/`)) sb += new TextDecoder().decode(this.storage.objects.get(k)!);
    return sb;
  }

  payloadKeys(runId: string): string[] {
    return this.storage.keys().filter((k) => k.startsWith(`kb/runs/${runId}/`));
  }

  async modes(runId: string): Promise<string[]> {
    return (await this.sql`SELECT DISTINCT mode FROM wiki.kb_batch_job WHERE run_id = ${runId}::uuid`).map((r) => String(r.mode));
  }

  async publishedSlugs(subject: string): Promise<string[]> {
    return (await this.sql`SELECT slug FROM wiki.kb_page WHERE subject_id = ${subject} AND status = 'PUBLISHED' ORDER BY slug`)
      .map((r) => String(r.slug));
  }

  async count(q: Promise<any[]>): Promise<number> {
    return Number((await q)[0]!.n);
  }
}
