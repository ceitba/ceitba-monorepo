// The pipeline's JPA entities (apps/api/src/main/java/org/ceitba/api/domain/kb/*) and
// their Session mappers. KbRunRequest and KbBatchJob are the logic's classes
// (src/features/kb/logic/types.ts); KbRun, KbRunSubject, KbFileDigest,
// KbSubjectState and the pipeline's view of KbPage live here.

import { sql } from 'drizzle-orm';
import { systemNowMicros } from '../../../lib/time';
import { Dec } from '../../kb/logic/decimal';
import { asBoolean, path, size, type JsonValue } from '../../kb/logic/jsonNode';
import { odtFromMicros, type Odt } from '../../kb/logic/odt';
import { KbBatchJob, KbRunRequest, type KbPageType } from '../../kb/logic/types';
import type { Mapper } from './session';
import { decOf, jsonOf, odtOf, pgDec, pgJson, pgTime } from './values';

/** @CreationTimestamp / @UpdateTimestamp / OffsetDateTime.now(): the JVM clock at its zone. */
export function jvmNow(): Odt {
  return odtFromMicros(systemNowMicros());
}

// ---- KbRun -------------------------------------------------------------------------------

/**
 * domain/kb/KbRun (V33 + V35): one pipeline run or eval. status RUNNING | WAITING |
 * BLOCKED_BY_COST_LIMIT | SUCCEEDED | PARTIAL | FAILED | CANCELLED; stage DETECT, DIGEST,
 * PLAN, WRITE, RETRY, PUBLISH|REPORT, DONE. Dynamic updates (the Session writes only
 * changed columns).
 */
export class KbRun {
  id: string = crypto.randomUUID();
  status = 'RUNNING';
  stage: string | null = 'DETECT';
  stageLog: JsonValue = {};
  generator: string | null = null;
  tokensIn = 0;
  tokensOut = 0;
  tokensCached = 0;
  expectedCostUsd: Dec | null = null;
  costApproved = false;
  simulated = false;
  estimatedTokens = 0;
  costEstimate: Dec | null = null;
  error: string | null = null;
  finishedAt: Odt | null = null;
  updatedAt: Odt = jvmNow();

  constructor(
    public trigger: string,
    public dryRun: boolean,
    public promptVersion: string | null,
    public model: string | null,
    public startedAt: Odt,
    public subjects: JsonValue = {},
    public stats: JsonValue = {},
  ) {}

  isActive(): boolean {
    return this.status === 'RUNNING' || this.status === 'WAITING' || this.status === 'BLOCKED_BY_COST_LIMIT';
  }

  isEval(): boolean {
    return this.trigger === 'EVAL';
  }

  addCached(cached: number): void {
    this.tokensCached += cached;
  }

  addCost(cost: Dec): void {
    this.costEstimate = (this.costEstimate ?? Dec.ZERO).add(cost);
  }

  addTokens(i: number, o: number): void {
    this.tokensIn += i;
    this.tokensOut += o;
  }

  addEstimated(tokens: number): void {
    this.estimatedTokens += tokens;
  }

  finish(status: string, at: Odt): void {
    this.status = status;
    this.finishedAt = at;
  }
}

export const runMapper: Mapper<KbRun> = {
  table: 'wiki.kb_run',
  key: (r) => r.id,
  where: (r) => sql`id = ${r.id}::uuid`,
  updateTimestamp: 'updated_at',
  columns: {
    id: ['uuid', (r) => r.id],
    status: ['text', (r) => r.status],
    trigger: ['text', (r) => r.trigger],
    stage: ['text', (r) => r.stage],
    stage_log: ['jsonb', (r) => pgJson(r.stageLog)],
    dry_run: ['bool', (r) => r.dryRun],
    prompt_version: ['text', (r) => r.promptVersion],
    model: ['text', (r) => r.model],
    generator: ['text', (r) => r.generator],
    subjects: ['jsonb', (r) => pgJson(r.subjects)],
    stats: ['jsonb', (r) => pgJson(r.stats)],
    tokens_in: ['bigint', (r) => r.tokensIn],
    tokens_out: ['bigint', (r) => r.tokensOut],
    tokens_cached: ['bigint', (r) => r.tokensCached],
    expected_cost_usd: ['numeric', (r) => pgDec(r.expectedCostUsd)],
    cost_approved: ['bool', (r) => r.costApproved],
    simulated: ['bool', (r) => r.simulated],
    estimated_tokens: ['bigint', (r) => r.estimatedTokens],
    cost_estimate: ['numeric', (r) => pgDec(r.costEstimate)],
    error: ['text', (r) => r.error],
    started_at: ['timestamptz', (r) => pgTime(r.startedAt)],
    finished_at: ['timestamptz', (r) => pgTime(r.finishedAt)],
    updated_at: ['timestamptz', (r) => pgTime(r.updatedAt)],
  },
};

export const RUN_COLUMNS = sql.raw(`id, status, trigger, stage, stage_log::text AS stage_log, dry_run, prompt_version, model,
  generator, subjects::text AS subjects, stats::text AS stats, tokens_in, tokens_out, tokens_cached, expected_cost_usd,
  cost_approved, simulated, estimated_tokens, cost_estimate, error, started_at, finished_at, updated_at`);

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export function runOf(row: Row): KbRun {
  const r = new KbRun(String(row.trigger), Boolean(row.dry_run), s(row.prompt_version), s(row.model), odtOf(s(row.started_at))!,
    jsonOf(s(row.subjects)) ?? {}, jsonOf(s(row.stats)) ?? {});
  r.id = String(row.id);
  r.status = String(row.status);
  r.stage = s(row.stage);
  r.stageLog = jsonOf(s(row.stage_log)) ?? {};
  r.generator = s(row.generator);
  r.tokensIn = n(row.tokens_in);
  r.tokensOut = n(row.tokens_out);
  r.tokensCached = n(row.tokens_cached);
  r.expectedCostUsd = decOf(s(row.expected_cost_usd));
  r.costApproved = Boolean(row.cost_approved);
  r.simulated = Boolean(row.simulated);
  r.estimatedTokens = n(row.estimated_tokens);
  r.costEstimate = decOf(s(row.cost_estimate));
  r.error = s(row.error);
  r.finishedAt = odtOf(s(row.finished_at));
  r.updatedAt = odtOf(s(row.updated_at))!;
  return r;
}

// ---- KbRunSubject ----------------------------------------------------------------------------

/**
 * domain/kb/KbRunSubject (V35): a dirty subject inside a run. status PENDING, DEFERRED,
 * FAILED, PUBLISHED, DRY, CANCELLED.
 */
export class KbRunSubject {
  status = 'PENDING';
  operations: JsonValue = [];
  drafts: JsonValue = {};
  accepted: JsonValue = [];
  rejected: JsonValue = [];
  deleted: JsonValue = [];
  skipped: JsonValue = [];
  tokensIn = 0;
  tokensOut = 0;
  tokensCached = 0;
  costEstimate: Dec = Dec.ZERO;
  error: string | null = null;

  constructor(
    readonly runId: string,
    readonly subjectId: string,
    readonly model: string,
    readonly priority: number,
    public inputs: JsonValue,
    public added: JsonValue,
    public changed: JsonValue,
    public removed: JsonValue,
  ) {}

  isActive(): boolean {
    return this.status === 'PENDING';
  }

  fail(error: string): void {
    this.status = 'FAILED';
    this.error = error;
  }

  /** Files without a digest, dropped from this run's inputs (they stay pending). */
  skip(skipped: JsonValue, inputs: JsonValue, added: JsonValue, changed: JsonValue): void {
    this.skipped = skipped;
    this.inputs = inputs;
    this.added = added;
    this.changed = changed;
  }

  setOutcome(accepted: JsonValue, rejected: JsonValue, deleted: JsonValue): void {
    this.accepted = accepted;
    this.rejected = rejected;
    this.deleted = deleted;
  }

  addUsage(i: number, o: number, cached: number, cost: Dec): void {
    this.tokensIn += i;
    this.tokensOut += o;
    this.tokensCached += cached;
    this.costEstimate = this.costEstimate.add(cost);
  }

  skippedCount(): number {
    return size(this.skipped);
  }
}

export const runSubjectMapper: Mapper<KbRunSubject> = {
  table: 'wiki.kb_run_subject',
  key: (r) => `${r.runId}|${r.subjectId}`,
  where: (r) => sql`run_id = ${r.runId}::uuid AND subject_id = ${r.subjectId}`,
  columns: {
    run_id: ['uuid', (r) => r.runId],
    subject_id: ['text', (r) => r.subjectId],
    status: ['text', (r) => r.status],
    model: ['text', (r) => r.model],
    priority: ['bigint', (r) => r.priority],
    inputs: ['jsonb', (r) => pgJson(r.inputs)],
    added: ['jsonb', (r) => pgJson(r.added)],
    changed: ['jsonb', (r) => pgJson(r.changed)],
    removed: ['jsonb', (r) => pgJson(r.removed)],
    operations: ['jsonb', (r) => pgJson(r.operations)],
    drafts: ['jsonb', (r) => pgJson(r.drafts)],
    accepted: ['jsonb', (r) => pgJson(r.accepted)],
    rejected: ['jsonb', (r) => pgJson(r.rejected)],
    deleted: ['jsonb', (r) => pgJson(r.deleted)],
    skipped: ['jsonb', (r) => pgJson(r.skipped)],
    tokens_in: ['bigint', (r) => r.tokensIn],
    tokens_out: ['bigint', (r) => r.tokensOut],
    tokens_cached: ['bigint', (r) => r.tokensCached],
    cost_estimate: ['numeric', (r) => pgDec(r.costEstimate)],
    error: ['text', (r) => r.error],
  },
};

export const RUN_SUBJECT_COLUMNS = sql.raw(`run_id, subject_id, status, model, priority, inputs::text AS inputs,
  added::text AS added, changed::text AS changed, removed::text AS removed, operations::text AS operations,
  drafts::text AS drafts, accepted::text AS accepted, rejected::text AS rejected, deleted::text AS deleted,
  skipped::text AS skipped, tokens_in, tokens_out, tokens_cached, cost_estimate, error`);

export function runSubjectOf(row: Row): KbRunSubject {
  const r = new KbRunSubject(String(row.run_id), String(row.subject_id), String(row.model), n(row.priority),
    jsonOf(s(row.inputs)) ?? [], jsonOf(s(row.added)) ?? [], jsonOf(s(row.changed)) ?? [], jsonOf(s(row.removed)) ?? []);
  r.status = String(row.status);
  r.operations = jsonOf(s(row.operations)) ?? [];
  r.drafts = jsonOf(s(row.drafts)) ?? {};
  r.accepted = jsonOf(s(row.accepted)) ?? [];
  r.rejected = jsonOf(s(row.rejected)) ?? [];
  r.deleted = jsonOf(s(row.deleted)) ?? [];
  r.skipped = jsonOf(s(row.skipped)) ?? [];
  r.tokensIn = n(row.tokens_in);
  r.tokensOut = n(row.tokens_out);
  r.tokensCached = n(row.tokens_cached);
  r.costEstimate = decOf(s(row.cost_estimate)) ?? Dec.ZERO;
  r.error = s(row.error);
  return r;
}

// ---- KbRunRequest ------------------------------------------------------------------------------

export const requestMapper: Mapper<KbRunRequest> = {
  table: 'wiki.kb_run_request',
  key: (r) => r.customId,
  where: (r) => sql`custom_id = ${r.customId}`,
  byReference: ['params', 'result'],
  columns: {
    custom_id: ['text', (r) => r.customId],
    run_id: ['uuid', (r) => r.runId],
    batch_job_id: ['uuid', (r) => r.batchJobId],
    stage: ['text', (r) => r.stage],
    subject_id: ['text', (r) => r.subjectId],
    item_key: ['text', (r) => r.itemKey],
    target: ['text', (r) => r.target],
    chunk: ['int', (r) => r.chunk],
    model: ['text', (r) => r.model],
    params: ['jsonb', (r) => (r.params === undefined ? null : pgJsonCached(r.params))],
    est_tokens: ['int', (r) => r.estTokens],
    status: ['text', (r) => r.status],
    result: ['jsonb', (r) => (r.result == null ? null : pgJsonCached(r.result))],
    error: ['text', (r) => r.error],
    tokens_in: ['int', (r) => r.tokensIn],
    tokens_out: ['int', (r) => r.tokensOut],
    tokens_cached: ['int', (r) => r.tokensCached],
    exec_path: ['text', (r) => r.execPath],
    created_at: ['timestamptz', (r) => pgTime(r.createdAt)],
    completed_at: ['timestamptz', (r) => pgTime(r.completedAt)],
    latency_ms: ['int', (r) => r.latencyMs],
    content_fingerprint: ['text', (r) => r.contentFingerprint],
  },
};

// params/result are compared by reference: the mapper hands the Session the
// node itself as the snapshot value, and serializes it only when written.
const serialized = new WeakMap<object, string>();
function pgJsonCached(v: JsonValue): unknown {
  if (v !== null && typeof v === 'object') {
    let t = serialized.get(v);
    if (t === undefined) {
      t = pgJson(v)!;
      serialized.set(v, t);
    }
    return t;
  }
  return pgJson(v);
}

export const REQUEST_COLUMNS = sql.raw(`custom_id, run_id, batch_job_id, stage, subject_id, item_key, target, chunk, model,
  params::text AS params, est_tokens, status, result::text AS result, error, tokens_in, tokens_out, tokens_cached,
  exec_path, created_at, completed_at, latency_ms, content_fingerprint`);

export function requestOf(row: Row): KbRunRequest {
  const r = new KbRunRequest(String(row.custom_id), String(row.run_id), String(row.stage), String(row.subject_id),
    String(row.item_key), String(row.target), n(row.chunk), String(row.model), jsonOf(s(row.params)) ?? {}, n(row.est_tokens));
  r.batchJobId = s(row.batch_job_id);
  r.status = String(row.status);
  r.result = jsonOf(s(row.result));
  r.error = s(row.error);
  r.tokensIn = n(row.tokens_in);
  r.tokensOut = n(row.tokens_out);
  r.tokensCached = n(row.tokens_cached);
  r.execPath = s(row.exec_path);
  r.createdAt = odtOf(s(row.created_at));
  r.completedAt = odtOf(s(row.completed_at));
  r.latencyMs = row.latency_ms == null ? null : n(row.latency_ms);
  r.contentFingerprint = s(row.content_fingerprint);
  return r;
}

// ---- KbBatchJob -------------------------------------------------------------------------------

export const jobMapper: Mapper<KbBatchJob> = {
  table: 'wiki.kb_batch_job',
  key: (j) => j.id!,
  where: (j) => sql`id = ${j.id}::uuid`,
  columns: {
    id: ['uuid', (j) => j.id],
    run_id: ['uuid', (j) => j.runId],
    stage: ['text', (j) => j.stage],
    attempt: ['int', (j) => j.attempt],
    model: ['text', (j) => j.model],
    mode: ['text', (j) => j.mode],
    do_batch_id: ['text', (j) => j.doBatchId],
    do_file_id: ['text', (j) => j.doFileId],
    status: ['text', (j) => j.status],
    request_count: ['int', (j) => j.requestCount],
    payload_key: ['text', (j) => j.payloadKey],
    output_key: ['text', (j) => j.outputKey],
    tokens_in: ['bigint', (j) => j.tokensIn],
    tokens_out: ['bigint', (j) => j.tokensOut],
    tokens_cached: ['bigint', (j) => j.tokensCached],
    cost_estimate: ['numeric', (j) => pgDec(j.costEstimate)],
    submitted_at: ['timestamptz', (j) => pgTime(j.submittedAt)],
    completed_at: ['timestamptz', (j) => pgTime(j.completedAt)],
    output_file_url_fetched_at: ['timestamptz', (j) => pgTime(j.outputFetchedAt)],
    error: ['text', (j) => j.error],
    created_at: ['timestamptz', (j) => pgTime(j.createdAt)],
    do_status: ['text', (j) => j.doStatus],
    do_request_counts: ['jsonb', (j) => pgJson(j.doRequestCounts)],
    status_changed_at: ['timestamptz', (j) => pgTime(j.statusChangedAt)],
    next_attempt_at: ['timestamptz', (j) => pgTime(j.nextAttemptAt)],
    submit_failures: ['int', (j) => j.submitFailures],
    do_request_id: ['text', (j) => j.doRequestId],
    part: ['int', (j) => j.part],
  },
};

export const JOB_COLUMNS = sql.raw(`id, run_id, stage, attempt, model, mode, do_batch_id, do_file_id, status, request_count,
  payload_key, output_key, tokens_in, tokens_out, tokens_cached, cost_estimate, submitted_at, completed_at,
  output_file_url_fetched_at, error, created_at, do_status, do_request_counts::text AS do_request_counts,
  status_changed_at, next_attempt_at, submit_failures, do_request_id, part`);

export function jobOf(row: Row): KbBatchJob {
  const j = new KbBatchJob(String(row.run_id), String(row.stage), n(row.attempt), String(row.model), String(row.mode),
    n(row.request_count), s(row.payload_key));
  j.id = String(row.id);
  j.doBatchId = s(row.do_batch_id);
  j.doFileId = s(row.do_file_id);
  j.status = String(row.status);
  j.outputKey = s(row.output_key);
  j.tokensIn = n(row.tokens_in);
  j.tokensOut = n(row.tokens_out);
  j.tokensCached = n(row.tokens_cached);
  j.costEstimate = decOf(s(row.cost_estimate));
  j.submittedAt = odtOf(s(row.submitted_at));
  j.completedAt = odtOf(s(row.completed_at));
  j.outputFetchedAt = odtOf(s(row.output_file_url_fetched_at));
  j.error = s(row.error);
  j.createdAt = odtOf(s(row.created_at));
  j.doStatus = s(row.do_status);
  j.doRequestCounts = jsonOf(s(row.do_request_counts));
  j.statusChangedAt = odtOf(s(row.status_changed_at));
  j.nextAttemptAt = odtOf(s(row.next_attempt_at));
  j.submitFailures = n(row.submit_failures);
  j.doRequestId = s(row.do_request_id);
  j.part = n(row.part);
  return j;
}

// ---- KbFileDigest ------------------------------------------------------------------------------

/** domain/kb/KbFileDigest (V35): the digest of one file content version. */
export class KbFileDigest {
  id: string = crypto.randomUUID();
  createdAt: Odt = jvmNow();

  constructor(
    public fileId: string | null,
    readonly contentFingerprint: string,
    readonly promptVersion: string,
    public model: string,
    public digest: JsonValue,
    public tokensIn: number,
    public tokensOut: number,
  ) {}

  /** Merged from only some of the file's chunks: the next run digests the file again. */
  isPartial(): boolean {
    return this.digest != null && asBoolean(path(this.digest, 'partial'), false);
  }

  replace(model: string, digest: JsonValue, tokensIn: number, tokensOut: number): void {
    this.model = model;
    this.digest = digest;
    this.tokensIn = tokensIn;
    this.tokensOut = tokensOut;
  }
}

export const digestMapper: Mapper<KbFileDigest> = {
  table: 'wiki.kb_file_digest',
  key: (d) => d.id,
  where: (d) => sql`id = ${d.id}::uuid`,
  columns: {
    id: ['uuid', (d) => d.id],
    file_id: ['uuid', (d) => d.fileId],
    content_fingerprint: ['text', (d) => d.contentFingerprint],
    prompt_version: ['text', (d) => d.promptVersion],
    model: ['text', (d) => d.model],
    digest: ['jsonb', (d) => pgJson(d.digest)],
    tokens_in: ['int', (d) => d.tokensIn],
    tokens_out: ['int', (d) => d.tokensOut],
    created_at: ['timestamptz', (d) => pgTime(d.createdAt)],
  },
};

export const DIGEST_COLUMNS = sql.raw(`id, file_id, content_fingerprint, prompt_version, model, digest::text AS digest,
  tokens_in, tokens_out, created_at`);

export function digestOf(row: Row): KbFileDigest {
  const d = new KbFileDigest(s(row.file_id), String(row.content_fingerprint), String(row.prompt_version), String(row.model),
    jsonOf(s(row.digest)) ?? {}, n(row.tokens_in), n(row.tokens_out));
  d.id = String(row.id);
  d.createdAt = odtOf(s(row.created_at))!;
  return d;
}

// ---- KbSubjectState ------------------------------------------------------------------------------

/** domain/kb/KbSubjectState (V35): the inputs a subject's wiki was last compiled from. */
export class KbSubjectState {
  inputsHash: string | null = null;
  inputs: JsonValue | null = null;
  compiledAt: Odt | null = null;
  lastRunId: string | null = null;
  /** Not in the database yet (save() inserts it). */
  isNew = true;

  constructor(readonly subjectId: string) {}

  compiled(hash: string, inputs: JsonValue, at: Odt, runId: string | null): void {
    this.inputsHash = hash;
    this.inputs = inputs;
    this.compiledAt = at;
    this.lastRunId = runId;
  }
}

export const stateMapper: Mapper<KbSubjectState> = {
  table: 'wiki.kb_subject_state',
  key: (st) => st.subjectId,
  where: (st) => sql`subject_id = ${st.subjectId}`,
  columns: {
    subject_id: ['text', (st) => st.subjectId],
    inputs_hash: ['text', (st) => st.inputsHash],
    inputs: ['jsonb', (st) => pgJson(st.inputs)],
    compiled_at: ['timestamptz', (st) => pgTime(st.compiledAt)],
    last_run_id: ['uuid', (st) => st.lastRunId],
  },
};

export function stateOf(row: Row): KbSubjectState {
  const st = new KbSubjectState(String(row.subject_id));
  st.inputsHash = s(row.inputs_hash);
  st.inputs = jsonOf(s(row.inputs));
  st.compiledAt = odtOf(s(row.compiled_at));
  st.lastRunId = s(row.last_run_id);
  st.isNew = false;
  return st;
}

// ---- KbPage (what the pipeline reads and the status it writes) ---------------------------------

export const PAGE_TYPE_WIRE: Record<KbPageType, string> = { INDEX: 'index', TOPIC: 'topic', CONCEPT: 'concept' };

/** domain/kb/KbPage, as the pipeline sees it; only status/hidden_reason are written here. */
export class KbPageView {
  status: string;
  hiddenReason: string | null;

  constructor(
    readonly id: string,
    readonly subjectId: string,
    readonly slug: string,
    readonly type: KbPageType,
    readonly title: string,
    readonly summary: string,
    readonly aliases: string[],
    readonly markdown: string,
    readonly sources: string[],
    readonly revision: number,
    readonly generator: string,
    readonly generatedAt: Odt,
    status: string,
    hiddenReason: string | null,
  ) {
    this.status = status;
    this.hiddenReason = hiddenReason;
  }

  wire(): string {
    return PAGE_TYPE_WIRE[this.type];
  }

  /** Any status but HIDDEN clears the hidden reason. */
  setStatus(status: string): void {
    this.status = status;
    if (status !== 'HIDDEN') this.hiddenReason = null;
  }
}

export const pageMapper: Mapper<KbPageView> = {
  table: 'wiki.kb_page',
  key: (p) => p.id,
  where: (p) => sql`id = ${p.id}::uuid`,
  updateTimestamp: 'updated_at',
  columns: {
    status: ['text', (p) => p.status],
    hidden_reason: ['text', (p) => p.hiddenReason],
  },
};

export const PAGE_COLUMNS = sql.raw(`id, subject_id, slug, type, title, summary, aliases, markdown, sources, revision,
  generator, generated_at, status, hidden_reason`);

function arrayOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    const t = v.replace(/^\{|\}$/g, '');
    return t === '' ? [] : t.split(',').map((x) => x.replace(/^"|"$/g, ''));
  }
  return [];
}

export function pageOf(row: Row): KbPageView {
  return new KbPageView(String(row.id), String(row.subject_id), String(row.slug), String(row.type) as KbPageType,
    String(row.title), String(row.summary), arrayOf(row.aliases), String(row.markdown), arrayOf(row.sources),
    n(row.revision), String(row.generator), odtOf(s(row.generated_at))!, String(row.status), s(row.hidden_reason));
}
