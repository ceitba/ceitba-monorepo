// Drizzle-backed implementations of the kb logic ports (src/features/kb/logic/ports.ts).
// Each call joins the caller's transaction (inTx) or runs in its own.

import { sql } from 'drizzle-orm';
import type { Database } from '../../../db/client';
import type {
  KbBatchJobStore, KbLlmEndpointStore, KbLlmUsageStore, KbModelReader, KbRunRequestStore, KbRunStore,
} from '../../kb/logic/ports';
import { KbLlmEndpoint, KbModel, type KbBatchJob, type KbLlmUsage, type KbRunRequest } from '../../kb/logic/types';
import { jobs, requests, runs } from './repo';
import { inTx } from './session';
import { decOf, jsonOf, odtOf, pgDec, pgTime } from './values';


type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function modelOf(r: Row): KbModel {
  const m = new KbModel(String(r.id), String(r.display_name), String(r.provider), Boolean(r.batch_supported), Boolean(r.enabled));
  m.batchSource = String(r.batch_source);
  m.batchVerifiedAt = odtOf(str(r.batch_verified_at));
  m.batchDiscountVerified = Boolean(r.batch_discount_verified);
  m.toolCalling = String(r.tool_calling);
  m.supportsReasoningEffort = Boolean(r.supports_reasoning_effort);
  m.inputPerM = decOf(str(r.input_per_m));
  m.outputPerM = decOf(str(r.output_per_m));
  m.cacheReadPerM = decOf(str(r.cache_read_per_m));
  m.batchDiscount = decOf(str(r.batch_discount))!;
  m.contextWindow = r.context_window == null ? null : Number(r.context_window);
  m.notes = str(r.notes);
  m.pricesUpdatedAt = odtOf(str(r.prices_updated_at));
  m.lastProbe = jsonOf(str(r.last_probe));
  m.createdAt = odtOf(str(r.created_at));
  m.maxOutputTokens = r.max_output_tokens == null ? null : Number(r.max_output_tokens);
  m.priceSource = str(r.price_source);
  m.displayNameManual = Boolean(r.display_name_manual);
  m.setBatchModelId(str(r.batch_model_id));
  m.remoteModelId = str(r.remote_model_id);
  return m;
}

const MODEL_COLUMNS = sql.raw(`id, display_name, provider, batch_supported, batch_source, batch_verified_at, tool_calling,
  supports_reasoning_effort, enabled, input_per_m, output_per_m, cache_read_per_m, batch_discount, batch_discount_verified,
  context_window, notes, prices_updated_at, last_probe::text AS last_probe, created_at, max_output_tokens, price_source,
  display_name_manual, batch_model_id, remote_model_id`);

/** repository/kb/KbModelRepository (reads; save() is the catalog's, not the pipeline's). */
export class DbKbModelStore implements KbModelReader {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<KbModel | null> {
    return inTx(this.db, async (s) => {
      const [r] = await s.query<Row>(sql`SELECT ${MODEL_COLUMNS} FROM wiki.kb_model WHERE id = ${id}`);
      return r ? modelOf(r) : null;
    });
  }

  findAll(): Promise<KbModel[]> {
    return inTx(this.db, async (s) => (await s.query<Row>(sql`SELECT ${MODEL_COLUMNS} FROM wiki.kb_model`)).map(modelOf));
  }
}

function endpointOf(r: Row): KbLlmEndpoint {
  const e = new KbLlmEndpoint(String(r.name), String(r.base_url), str(r.created_by), odtOf(str(r.created_at))!, String(r.id));
  e.apiKeyEncrypted = str(r.api_key_encrypted);
  e.maxConcurrency = Number(r.max_concurrency);
  e.timeoutSec = Number(r.timeout_sec);
  e.enabled = Boolean(r.enabled);
  e.updatedBy = str(r.updated_by);
  e.updatedAt = odtOf(str(r.updated_at))!;
  return e;
}

/** repository/kb/KbLlmEndpointRepository (reads). */
export class DbKbLlmEndpointStore implements KbLlmEndpointStore {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<KbLlmEndpoint | null> {
    return inTx(this.db, async (s) => {
      const [r] = await s.query<Row>(sql`SELECT * FROM wiki.kb_llm_endpoint WHERE id = ${id}::uuid`);
      return r ? endpointOf(r) : null;
    });
  }

  findByName(name: string): Promise<KbLlmEndpoint | null> {
    return inTx(this.db, async (s) => {
      const [r] = await s.query<Row>(sql`SELECT * FROM wiki.kb_llm_endpoint WHERE name = ${name}`);
      return r ? endpointOf(r) : null;
    });
  }
}

/** KbBatchJobRepository for KbBatchSubmitter (managed entities of the current transaction). */
export class DbKbBatchJobStore implements KbBatchJobStore {
  constructor(private readonly db: Database) {}
  findById(id: string): Promise<KbBatchJob | null> {
    return inTx(this.db, () => jobs.findById(id));
  }
  saveAndFlush(job: KbBatchJob): Promise<KbBatchJob> {
    return inTx(this.db, () => jobs.save(job));
  }
  save(job: KbBatchJob): Promise<KbBatchJob> {
    return inTx(this.db, async (s) => {
      await jobs.save(job);
      await s.flush();
      return job;
    });
  }
}

export class DbKbRunRequestStore implements KbRunRequestStore {
  constructor(private readonly db: Database) {}
  findAllById(ids: string[]): Promise<KbRunRequest[]> {
    return inTx(this.db, () => requests.findAllById(ids));
  }
  markSubmitted(jobId: string, customIds: string[]): Promise<number> {
    return inTx(this.db, () => requests.markSubmitted(jobId, customIds));
  }
  submittedIdsOfJob(jobId: string): Promise<string[]> {
    return inTx(this.db, () => requests.submittedIdsOfJob(jobId));
  }
  failSubmittedOfJob(jobId: string, error: string): Promise<number> {
    return inTx(this.db, () => requests.failSubmittedOfJob(jobId, error));
  }
}

export class DbKbRunStore implements KbRunStore {
  constructor(private readonly db: Database) {}
  setStatusIf(runId: string, status: string, from: readonly string[]): Promise<number> {
    return inTx(this.db, () => runs.setStatusIf(runId, status, from));
  }
}

/** kb_llm_usage inserts (every column, like Hibernate). */
export class DbKbLlmUsageStore implements KbLlmUsageStore {
  constructor(private readonly db: Database) {}
  save(u: KbLlmUsage): Promise<unknown> {
    return inTx(this.db, (s) => s.update(sql`INSERT INTO wiki.kb_llm_usage (id, created_at, run_id, eval_id, request_id, model,
      mode, stage, subject_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, simulated, attempt, latency_ms,
      reasoning_tokens) VALUES (${crypto.randomUUID()}::uuid, ${pgTime(u.createdAt)}::timestamptz, ${u.runId}::uuid,
      ${u.evalId}::uuid, ${u.requestId}, ${u.model}, ${u.mode}, ${u.stage}, ${u.subjectId}, ${u.inputTokens},
      ${u.cachedInputTokens}, ${u.outputTokens}, ${pgDec(u.costUsd)}::numeric, ${u.simulated}, ${u.attempt},
      ${u.latencyMs}::int, ${u.reasoningTokens}::int)`));
  }
}
