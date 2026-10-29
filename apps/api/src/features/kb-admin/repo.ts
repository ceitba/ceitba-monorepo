// repository/kb/* queries the kb admin services use (KbModelRepository,
// KbPipelineSettingsRow/HistoryRepository, KbModelPriceHistoryRepository,
// KbLlmEndpointRepository, KbLlmUsageRepository, KbRunRequestRepository,
// KbRunRepository, KbPageRepository, KbFileDigestRepository, KbSubjectStateRepository,
// DriveFileRepository projections). Raw SQL through drizzle's `sql` (bound
// parameters); timestamps, numerics and jsonb are selected as text so no
// precision is lost (values.ts converts them).

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { Dec } from '../kb/logic/decimal';
import type { JsonValue } from '../kb/logic/jsonNode';
import type { Odt } from '../kb/logic/odt';
import { KbLlmEndpoint, KbModel } from '../kb/logic/types';
import { decOf, jsonOf, odtOf, pgDec, pgJson, pgTime } from './values';

type Row = Record<string, unknown>;

export async function rows<R = Row>(db: Db, q: SQL): Promise<R[]> {
  return (await db.execute(q)) as unknown as R[];
}

const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** A Postgres array literal for `= ANY(...::type[])`. */
export function arrayLiteral(values: readonly (string | null)[]): string {
  return '{' + values.map((v) => (v === null ? 'NULL' : '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
}

// ---- users ------------------------------------------------------------------------

export async function userNames(db: Db, ids: Iterable<string | null>): Promise<Map<string, string | null>> {
  const list = [...new Set([...ids].filter((x): x is string => x != null))];
  const out = new Map<string, string | null>();
  if (!list.length) return out;
  for (const r of await rows(db, sql`SELECT id::text AS id, name FROM public."user" WHERE id = ANY(${arrayLiteral(list)}::uuid[])`)) {
    out.set(String(r.id), s(r.name));
  }
  return out;
}

// ---- settings ---------------------------------------------------------------------

export interface SettingsRow { settings: JsonValue; updatedBy: string | null; updatedAt: Odt }

export async function settingsRow(db: Db): Promise<SettingsRow | null> {
  const [r] = await rows(db, sql`SELECT settings::text AS settings, updated_by::text AS updated_by, updated_at::text AS updated_at
                                  FROM wiki.kb_pipeline_settings WHERE id = 1`);
  return r ? { settings: jsonOf(s(r.settings))!, updatedBy: s(r.updated_by), updatedAt: odtOf(s(r.updated_at))! } : null;
}

export async function insertSettingsRow(db: Db, settings: JsonValue, userId: string | null, at: Odt): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_pipeline_settings (id, settings, updated_by, updated_at)
                       VALUES (1, ${pgJson(settings)}::jsonb, ${userId}::uuid, ${pgTime(at)}::timestamptz)`);
}

export async function updateSettingsRow(db: Db, settings: JsonValue, userId: string | null, at: Odt): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_pipeline_settings SET settings = ${pgJson(settings)}::jsonb, updated_by = ${userId}::uuid,
                       updated_at = ${pgTime(at)}::timestamptz WHERE id = 1`);
}

export interface HistoryRow { id: string; settings: JsonValue; changedBy: string | null; changedAt: Odt; note: string | null }

const historyOf = (r: Row): HistoryRow => ({
  id: String(r.id), settings: jsonOf(s(r.settings))!, changedBy: s(r.changed_by), changedAt: odtOf(s(r.changed_at))!, note: s(r.note),
});

export async function insertHistory(db: Db, settings: JsonValue, userId: string | null, at: Odt, note: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_pipeline_settings_history (id, settings, changed_by, changed_at, note)
                       VALUES (gen_random_uuid(), ${pgJson(settings)}::jsonb, ${userId}::uuid, ${pgTime(at)}::timestamptz, ${note})`);
}

export async function historyPage(db: Db, limit: number): Promise<HistoryRow[]> {
  return (await rows(db, sql`SELECT id::text AS id, settings::text AS settings, changed_by::text AS changed_by,
                                    changed_at::text AS changed_at, note
                             FROM wiki.kb_pipeline_settings_history ORDER BY changed_at DESC LIMIT ${limit}`)).map(historyOf);
}

export async function historyById(db: Db, id: string): Promise<HistoryRow | null> {
  const [r] = await rows(db, sql`SELECT id::text AS id, settings::text AS settings, changed_by::text AS changed_by,
                                        changed_at::text AS changed_at, note
                                 FROM wiki.kb_pipeline_settings_history WHERE id = ${id}::uuid`);
  return r ? historyOf(r) : null;
}

// ---- models -----------------------------------------------------------------------

const MODEL_COLUMNS = sql.raw(`id, display_name, provider, batch_supported, batch_source, batch_verified_at::text AS batch_verified_at,
  tool_calling, supports_reasoning_effort, enabled, input_per_m::text AS input_per_m, output_per_m::text AS output_per_m,
  cache_read_per_m::text AS cache_read_per_m, batch_discount::text AS batch_discount, batch_discount_verified, context_window,
  notes, prices_updated_at::text AS prices_updated_at, last_probe::text AS last_probe, created_at::text AS created_at,
  max_output_tokens, price_source, display_name_manual, batch_model_id, remote_model_id`);

function modelOf(r: Row): KbModel {
  const m = new KbModel(String(r.id), String(r.display_name), String(r.provider), Boolean(r.batch_supported), Boolean(r.enabled));
  m.batchSource = String(r.batch_source);
  m.batchVerifiedAt = odtOf(s(r.batch_verified_at));
  m.toolCalling = String(r.tool_calling);
  m.supportsReasoningEffort = Boolean(r.supports_reasoning_effort);
  m.inputPerM = decOf(s(r.input_per_m));
  m.outputPerM = decOf(s(r.output_per_m));
  m.cacheReadPerM = decOf(s(r.cache_read_per_m));
  m.batchDiscount = decOf(s(r.batch_discount)) ?? Dec.parse('0.5');
  m.batchDiscountVerified = Boolean(r.batch_discount_verified);
  m.contextWindow = n(r.context_window);
  m.notes = s(r.notes);
  m.pricesUpdatedAt = odtOf(s(r.prices_updated_at));
  m.lastProbe = jsonOf(s(r.last_probe));
  m.createdAt = odtOf(s(r.created_at));
  m.maxOutputTokens = n(r.max_output_tokens);
  m.priceSource = s(r.price_source);
  m.displayNameManual = Boolean(r.display_name_manual);
  m.setBatchModelId(s(r.batch_model_id));
  m.remoteModelId = s(r.remote_model_id);
  return m;
}

export async function allModels(db: Db): Promise<KbModel[]> {
  return (await rows(db, sql`SELECT ${MODEL_COLUMNS} FROM wiki.kb_model ORDER BY id`)).map(modelOf);
}

export async function modelById(db: Db, id: string): Promise<KbModel | null> {
  const [r] = await rows(db, sql`SELECT ${MODEL_COLUMNS} FROM wiki.kb_model WHERE id = ${id}`);
  return r ? modelOf(r) : null;
}

export async function modelExists(db: Db, id: string): Promise<boolean> {
  return (await rows(db, sql`SELECT 1 FROM wiki.kb_model WHERE id = ${id}`)).length > 0;
}

export async function countModelsWithPrefix(db: Db, prefix: string): Promise<number> {
  const [r] = await rows(db, sql`SELECT count(*)::int AS n FROM wiki.kb_model WHERE starts_with(id, ${prefix})`);
  return Number(r!.n);
}

/** Hibernate's insert of a new KbModel (every column). */
export async function insertModel(db: Db, m: KbModel, createdAt: Odt): Promise<void> {
  m.createdAt = m.createdAt ?? createdAt;
  await db.execute(sql`INSERT INTO wiki.kb_model (id, display_name, provider, batch_supported, batch_source, batch_verified_at,
      tool_calling, supports_reasoning_effort, enabled, input_per_m, output_per_m, cache_read_per_m, batch_discount,
      batch_discount_verified, context_window, notes, prices_updated_at, last_probe, created_at, max_output_tokens, price_source,
      display_name_manual, batch_model_id, remote_model_id)
    VALUES (${m.id}, ${m.displayName}, ${m.provider}, ${m.isBatchSupported()}, ${m.batchSource}, ${pgTime(m.batchVerifiedAt)}::timestamptz,
      ${m.toolCalling}, ${m.supportsReasoningEffort}, ${m.enabled}, ${pgDec(m.inputPerM)}::numeric, ${pgDec(m.outputPerM)}::numeric,
      ${pgDec(m.cacheReadPerM)}::numeric, ${pgDec(m.batchDiscount)}::numeric, ${m.batchDiscountVerified}, ${m.contextWindow}::int,
      ${m.notes}, ${pgTime(m.pricesUpdatedAt)}::timestamptz, ${pgJson(m.lastProbe)}::jsonb, ${pgTime(m.createdAt)}::timestamptz,
      ${m.maxOutputTokens}::int, ${m.priceSource}, ${m.displayNameManual}, ${m.getBatchModelId()}, ${m.remoteModelId})`);
}

/** Hibernate's update of a loaded KbModel (every column). */
export async function updateModel(db: Db, m: KbModel): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_model SET display_name = ${m.displayName}, provider = ${m.provider},
      batch_supported = ${m.isBatchSupported()}, batch_source = ${m.batchSource}, batch_verified_at = ${pgTime(m.batchVerifiedAt)}::timestamptz,
      tool_calling = ${m.toolCalling}, supports_reasoning_effort = ${m.supportsReasoningEffort}, enabled = ${m.enabled},
      input_per_m = ${pgDec(m.inputPerM)}::numeric, output_per_m = ${pgDec(m.outputPerM)}::numeric,
      cache_read_per_m = ${pgDec(m.cacheReadPerM)}::numeric, batch_discount = ${pgDec(m.batchDiscount)}::numeric,
      batch_discount_verified = ${m.batchDiscountVerified}, context_window = ${m.contextWindow}::int, notes = ${m.notes},
      prices_updated_at = ${pgTime(m.pricesUpdatedAt)}::timestamptz, last_probe = ${pgJson(m.lastProbe)}::jsonb,
      max_output_tokens = ${m.maxOutputTokens}::int, price_source = ${m.priceSource}, display_name_manual = ${m.displayNameManual},
      batch_model_id = ${m.getBatchModelId()}, remote_model_id = ${m.remoteModelId}
    WHERE id = ${m.id}`);
}

export async function deleteModelsWithPrefix(db: Db, prefix: string): Promise<void> {
  await db.execute(sql`DELETE FROM wiki.kb_model WHERE starts_with(id, ${prefix})`);
}

export async function insertPriceHistory(db: Db, modelId: string, field: string, oldValue: string | null, newValue: string | null, at: Odt, source: string): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_model_price_history (id, model_id, field, old_value, new_value, changed_at, source)
                       VALUES (gen_random_uuid(), ${modelId}, ${field}, ${oldValue}, ${newValue}, ${pgTime(at)}::timestamptz, ${source})`);
}

/** [model, requests, empty-or-truncated answers] over each model's last 200 answered or failed requests. */
export async function emptyToolCallStats(db: Db): Promise<{ model: string; total: number; empty: number }[]> {
  return (await rows(db, sql`SELECT model, count(*)::bigint AS total,
        count(*) FILTER (WHERE error LIKE 'EMPTY_TOOL%' OR error LIKE 'TRUNCATED%' OR exec_path LIKE '%+retry')::bigint AS empty
      FROM (SELECT model, error, exec_path, row_number() OVER (PARTITION BY model ORDER BY created_at DESC) AS rn
            FROM wiki.kb_run_request WHERE status IN ('DONE', 'FAILED')) t
      WHERE rn <= 200 GROUP BY model`)).map((r) => ({ model: String(r.model), total: Number(r.total), empty: Number(r.empty) }));
}

// ---- endpoints --------------------------------------------------------------------

const ENDPOINT_COLUMNS = sql.raw(`id::text AS id, name, base_url, api_key_encrypted, max_concurrency, timeout_sec, enabled,
  created_by::text AS created_by, created_at::text AS created_at, updated_by::text AS updated_by, updated_at::text AS updated_at`);

function endpointOf(r: Row): KbLlmEndpoint {
  const e = Object.create(KbLlmEndpoint.prototype) as KbLlmEndpoint;
  Object.assign(e, {
    id: String(r.id), name: String(r.name), baseUrl: String(r.base_url), apiKeyEncrypted: s(r.api_key_encrypted),
    maxConcurrency: Number(r.max_concurrency), timeoutSec: Number(r.timeout_sec), enabled: Boolean(r.enabled),
    createdBy: s(r.created_by), createdAt: odtOf(s(r.created_at)), updatedBy: s(r.updated_by), updatedAt: odtOf(s(r.updated_at)),
  });
  return e;
}

export async function allEndpoints(db: Db): Promise<KbLlmEndpoint[]> {
  return (await rows(db, sql`SELECT ${ENDPOINT_COLUMNS} FROM wiki.kb_llm_endpoint ORDER BY name`)).map(endpointOf);
}

export async function endpointById(db: Db, id: string): Promise<KbLlmEndpoint | null> {
  const [r] = await rows(db, sql`SELECT ${ENDPOINT_COLUMNS} FROM wiki.kb_llm_endpoint WHERE id = ${id}::uuid`);
  return r ? endpointOf(r) : null;
}

export async function endpointByName(db: Db, name: string): Promise<KbLlmEndpoint | null> {
  const [r] = await rows(db, sql`SELECT ${ENDPOINT_COLUMNS} FROM wiki.kb_llm_endpoint WHERE name = ${name}`);
  return r ? endpointOf(r) : null;
}

export async function insertEndpoint(db: Db, e: KbLlmEndpoint): Promise<void> {
  await db.execute(sql`INSERT INTO wiki.kb_llm_endpoint (id, name, base_url, api_key_encrypted, max_concurrency, timeout_sec, enabled,
      created_by, created_at, updated_by, updated_at)
    VALUES (${e.id}::uuid, ${e.name}, ${e.baseUrl}, ${e.apiKeyEncrypted}, ${e.maxConcurrency}, ${e.timeoutSec}, ${e.enabled},
      ${e.createdBy}::uuid, ${pgTime(e.createdAt)}::timestamptz, ${e.updatedBy}::uuid, ${pgTime(e.updatedAt)}::timestamptz)`);
}

export async function updateEndpoint(db: Db, e: KbLlmEndpoint): Promise<void> {
  await db.execute(sql`UPDATE wiki.kb_llm_endpoint SET name = ${e.name}, base_url = ${e.baseUrl}, api_key_encrypted = ${e.apiKeyEncrypted},
      max_concurrency = ${e.maxConcurrency}, timeout_sec = ${e.timeoutSec}, enabled = ${e.enabled}, created_by = ${e.createdBy}::uuid,
      created_at = ${pgTime(e.createdAt)}::timestamptz, updated_by = ${e.updatedBy}::uuid, updated_at = ${pgTime(e.updatedAt)}::timestamptz
    WHERE id = ${e.id}::uuid`);
}

export async function deleteEndpoint(db: Db, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM wiki.kb_llm_endpoint WHERE id = ${id}::uuid`);
}

export interface EndpointStatsRow { calls: number; empty: number; p50: number | null; p95: number | null; outTokens: number; latencyMs: number }

export async function endpointStats(db: Db, prefix: string, since: Odt): Promise<EndpointStatsRow> {
  const [r] = await rows(db, sql`SELECT count(*)::bigint AS calls,
        count(*) FILTER (WHERE output_tokens = 0)::bigint AS empty,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
        coalesce(sum(output_tokens) FILTER (WHERE latency_ms > 0), 0)::float8 AS out_tokens,
        coalesce(sum(latency_ms) FILTER (WHERE latency_ms > 0), 0)::float8 AS latency
      FROM wiki.kb_llm_usage WHERE starts_with(model, ${prefix}) AND created_at >= ${pgTime(since)}::timestamptz AND mode = 'SYNC'`);
  return {
    calls: Number(r!.calls), empty: Number(r!.empty), p50: n(r!.p50), p95: n(r!.p95),
    outTokens: Number(r!.out_tokens), latencyMs: Number(r!.latency),
  };
}

/** Requests of runs in `statuses` whose model starts with `prefix`. */
export async function countActiveRunRequestsWithModelPrefix(db: Db, prefix: string, statuses: readonly string[]): Promise<number> {
  const [r] = await rows(db, sql`SELECT count(*)::bigint AS n FROM wiki.kb_run_request r
      WHERE starts_with(r.model, ${prefix}) AND r.run_id IN (SELECT id FROM wiki.kb_run WHERE status = ANY(${arrayLiteral([...statuses])}::text[]))`);
  return Number(r!.n);
}

// ---- forecast inputs ----------------------------------------------------------------

export interface UsageRow {
  runId: string | null; model: string; mode: string; stage: string; subjectId: string | null;
  inputTokens: number; cachedInputTokens: number; outputTokens: number; costUsd: Dec; simulated: boolean; createdAt: Odt;
}

const USAGE_COLUMNS = sql.raw(`run_id::text AS run_id, model, mode, stage, subject_id, input_tokens, cached_input_tokens,
  output_tokens, cost_usd::text AS cost_usd, simulated, created_at::text AS created_at`);

const usageOf = (r: Row): UsageRow => ({
  runId: s(r.run_id), model: String(r.model), mode: String(r.mode), stage: String(r.stage), subjectId: s(r.subject_id),
  inputTokens: Number(r.input_tokens), cachedInputTokens: Number(r.cached_input_tokens), outputTokens: Number(r.output_tokens),
  costUsd: Dec.parse(String(r.cost_usd)), simulated: Boolean(r.simulated), createdAt: odtOf(s(r.created_at))!,
});

export async function usageBetween(db: Db, from: Odt, to: Odt): Promise<UsageRow[]> {
  return (await rows(db, sql`SELECT ${USAGE_COLUMNS} FROM wiki.kb_llm_usage
      WHERE created_at BETWEEN ${pgTime(from)}::timestamptz AND ${pgTime(to)}::timestamptz`)).map(usageOf);
}

export async function usageOfRuns(db: Db, runIds: string[]): Promise<UsageRow[]> {
  if (!runIds.length) return [];
  return (await rows(db, sql`SELECT ${USAGE_COLUMNS} FROM wiki.kb_llm_usage WHERE run_id = ANY(${arrayLiteral(runIds)}::uuid[])`)).map(usageOf);
}

export interface RunHead { id: string; status: string; trigger: string }

/** findByTriggerNotOrderByStartedAtDesc(trigger, PageRequest.of(0, limit)). */
export async function runsNotTriggered(db: Db, trigger: string, limit: number): Promise<RunHead[]> {
  return (await rows(db, sql`SELECT id::text AS id, status, trigger FROM wiki.kb_run WHERE trigger <> ${trigger}
      ORDER BY started_at DESC LIMIT ${limit}`)).map((r) => ({ id: String(r.id), status: String(r.status), trigger: String(r.trigger) }));
}

/** [model, stage, outputTokens] of answers since `since` (latest first). */
export async function recentOutputTokens(db: Db, since: Odt): Promise<{ model: string; stage: string; out: number }[]> {
  return (await rows(db, sql`SELECT model, stage, tokens_out FROM wiki.kb_run_request
      WHERE status = 'DONE' AND tokens_out > 0 AND created_at >= ${pgTime(since)}::timestamptz
      ORDER BY created_at DESC LIMIT 5000`)).map((r) => ({ model: String(r.model), stage: String(r.stage), out: Number(r.tokens_out) }));
}

/** [subjectId, sources] of every page with one of `statuses`. */
export async function subjectSources(db: Db, statuses: readonly string[]): Promise<{ subjectId: string; sources: string[] }[]> {
  return (await rows(db, sql`SELECT subject_id, sources::text[] AS sources FROM wiki.kb_page
      WHERE status = ANY(${arrayLiteral([...statuses])}::text[])`)).map((r) => ({
    subjectId: String(r.subject_id), sources: (r.sources as string[] | null) ?? [],
  }));
}

export async function subjectIdsWithPagesNotRemoved(db: Db): Promise<string[]> {
  return (await rows(db, sql`SELECT DISTINCT subject_id FROM wiki.kb_page WHERE status <> 'REMOVED'`)).map((r) => String(r.subject_id));
}

/** Fingerprints (of `fps`) with a digest for `promptVersion`; `full`: only non-partial ones. */
export async function digestsByFingerprint(db: Db, fps: string[], promptVersion: string): Promise<{ id: string; fingerprint: string; partial: boolean; digest: JsonValue }[]> {
  if (!fps.length) return [];
  return (await rows(db, sql`SELECT id::text AS id, content_fingerprint, digest::text AS digest FROM wiki.kb_file_digest
      WHERE content_fingerprint = ANY(${arrayLiteral(fps)}::text[]) AND prompt_version = ${promptVersion}`)).map((r) => {
    const digest = jsonOf(s(r.digest))!;
    const partial = typeof digest === 'object' && digest !== null && !Array.isArray(digest) && (digest as Record<string, unknown>).partial === true;
    return { id: String(r.id), fingerprint: String(r.content_fingerprint), partial, digest };
  });
}

export async function countPublishedModifiedSince(db: Db, since: Odt): Promise<number> {
  const [r] = await rows(db, sql`SELECT count(*)::bigint AS n FROM wiki.drive_file
      WHERE publication = 'PUBLISHED' AND text_content IS NOT NULL AND drive_modified_at >= ${pgTime(since)}::timestamptz`);
  return Number(r!.n);
}

/** [id, effectiveSubjectId, fingerprint, academicYear, name, textLength] of published files with usable text. */
export async function pipelineInputs(db: Db, minChars: number) {
  return (await rows(db, sql`SELECT id::text AS id, effective_subject_id, content_fingerprint, academic_year, name, length(text_content) AS chars
      FROM wiki.drive_file WHERE publication = 'PUBLISHED' AND kind <> 'FOLDER' AND effective_subject_id IS NOT NULL
        AND text_content IS NOT NULL AND length(text_content) >= ${minChars}`)).map((r) => ({
    fileId: String(r.id), subjectId: String(r.effective_subject_id), fingerprint: s(r.content_fingerprint),
    academicYear: n(r.academic_year), name: String(r.name), chars: Number(r.chars),
  }));
}

export async function subjectStates(db: Db): Promise<{ subjectId: string; inputs: JsonValue }[]> {
  return (await rows(db, sql`SELECT subject_id, inputs::text AS inputs FROM wiki.kb_subject_state`)).map((r) => ({
    subjectId: String(r.subject_id), inputs: jsonOf(s(r.inputs))!,
  }));
}
