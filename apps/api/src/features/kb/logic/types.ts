// Minimal TS mirrors of the JPA entities (apps/api/src/main/java/org/ceitba/api/domain/kb/*)
// that the pure kb logic reads. Field names are the Java ones (camelCase); the
// service layer maps drizzle rows (src/db/schema/kb.ts) to these.

import { equalsIgnoreCase, jIsBlank, lowerRoot } from './javaString';
import { Dec, dec } from './decimal';
import { asBoolean, asInt, asText, at, deepCopy, isObject, path, type JsonValue } from './jsonNode';
import type { Odt } from './odt';
import { javaTrim } from '../../../lib/javaCompat';

/** domain/kb/KbPageType. */
export const KB_PAGE_TYPES = ['INDEX', 'TOPIC', 'CONCEPT'] as const;
export type KbPageType = (typeof KB_PAGE_TYPES)[number];

/**
 * domain/kb/KbModel (wiki.kb_model, V35): a model of the catalog. Prices are
 * USD per million tokens; null price = unknown (cost recorded as 0). Same
 * getters/setters semantics as the entity, including probeIn/selectableIn.
 */
export class KbModel {
  batchSource = 'rule';
  batchVerifiedAt: Odt | null = null;
  batchDiscountVerified = false;
  toolCalling = 'unknown';
  supportsReasoningEffort = false;
  inputPerM: Dec | null = null;
  outputPerM: Dec | null = null;
  cacheReadPerM: Dec | null = null;
  batchDiscount: Dec = dec('0.5');
  contextWindow: number | null = null;
  notes: string | null = null;
  pricesUpdatedAt: Odt | null = null;
  lastProbe: JsonValue | null = null;
  createdAt: Odt | null = null;
  maxOutputTokens: number | null = null;
  priceSource: string | null = null;
  displayNameManual = false;
  /** The id batch JSONL lines use (V38); null = the catalog id without its openai-/anthropic- prefix. */
  private batchModelIdValue: string | null = null;
  /** Custom endpoint models only (V52): the id the endpoint knows, sent in the request body. */
  remoteModelId: string | null = null;

  constructor(
    readonly id: string,
    public displayName: string,
    public provider: string,
    private batchSupportedValue: boolean,
    public enabled: boolean,
  ) {}

  /** Any successful probe (either mode). */
  probeSucceeded(): boolean {
    return this.probeOk('sync') || this.probeOk('batch');
  }

  /** The mode a stage would run this model in (BATCH | SYNC) for an execution mode (auto | batch | sync). */
  modeFor(executionMode: string | null): 'BATCH' | 'SYNC' {
    const batch = this.batchSupportedValue && (this.id.startsWith('anthropic-') || this.id.startsWith('openai-'));
    const m = executionMode == null ? 'auto' : lowerRoot(executionMode);
    return m === 'sync' || !batch ? 'SYNC' : 'BATCH';
  }

  /** The last probe in a mode (lastProbe.sync / lastProbe.batch; legacy entries count for their own mode). */
  probeIn(mode: string): JsonValue | null {
    const lp = this.lastProbe;
    if (lp == null) return null;
    const key = lowerRoot(mode);
    if (isObject(path(lp, key))) return path(lp, key)!;
    const perMode = path(lp, 'sync') !== undefined || path(lp, 'batch') !== undefined;
    return !perMode && key === asText(path(lp, 'mode'), '') ? lp : null;
  }

  probeOk(mode: string): boolean {
    const p = this.probeIn(mode);
    return p != null && asBoolean(path(p, 'ok'), false);
  }

  /** Selectable for a stage running in `mode`; a pending (or missing) batch probe falls back to the sync probe. */
  selectableIn(mode: string): boolean {
    if (!this.enabled) return false;
    if (!equalsIgnoreCase(mode, 'BATCH')) return this.probeOk('sync');
    if (this.probeOk('batch')) return true;
    const batch = this.probeIn('batch');
    const pendingOrNone = batch == null || asBoolean(at(batch, 'pending'), false);
    return pendingOrNone && this.probeOk('sync');
  }

  isBatchSupported(): boolean {
    return this.batchSupportedValue;
  }

  /** A batch probe decided it (overrides the rule). */
  setBatchFromProbe(supported: boolean, when: Odt): void {
    this.batchSupportedValue = supported;
    this.batchSource = 'probe';
    this.batchVerifiedAt = when;
  }

  /** Set by staff: clears a previous probe verdict. */
  setBatchSupported(v: boolean): void {
    this.batchSupportedValue = v;
    this.batchSource = 'rule';
    this.batchVerifiedAt = null;
  }

  setPrices(input: Dec | null, output: Dec | null, cacheRead: Dec | null, batchDiscount: Dec | null, when: Odt | null): void {
    this.inputPerM = input;
    this.outputPerM = output;
    this.cacheReadPerM = cacheRead;
    this.batchDiscount = batchDiscount == null ? dec('0.5') : batchDiscount;
    this.pricesUpdatedAt = when;
  }

  getBatchModelId(): string | null {
    return this.batchModelIdValue;
  }

  setBatchModelId(v: string | null): void {
    this.batchModelIdValue = v == null || jIsBlank(v) ? null : javaTrim(v);
  }
}

/** domain/kb/KbLlmEndpoint (wiki.kb_llm_endpoint, V51): a custom OpenAI-compatible endpoint. */
export class KbLlmEndpoint {
  apiKeyEncrypted: string | null = null;
  maxConcurrency = 2;
  timeoutSec = 600;
  enabled = true;
  createdBy: string | null;
  createdAt: Odt;
  updatedBy: string | null;
  updatedAt: Odt;

  constructor(
    public name: string,
    public baseUrl: string,
    by: string | null,
    at: Odt,
    readonly id: string = crypto.randomUUID(),
  ) {
    this.createdBy = by;
    this.createdAt = at;
    this.updatedBy = by;
    this.updatedAt = at;
  }

  touch(by: string | null, at: Odt): void {
    this.updatedBy = by;
    this.updatedAt = at;
  }

  hasKey(): boolean {
    return this.apiKeyEncrypted != null && !jIsBlank(this.apiKeyEncrypted);
  }
}

/**
 * domain/kb/KbBatchJob (wiki.kb_batch_job, V35/V38/V49): one DO batch of a run stage.
 * status: DRY, QUEUED, SUBMITTED, COMPLETED, FAILED, CANCELLED.
 */
export class KbBatchJob {
  id: string | null = null;
  tokensCached = 0;
  costEstimate: Dec | null = null;
  doBatchId: string | null = null;
  doFileId: string | null = null;
  status = 'DRY';
  outputKey: string | null = null;
  tokensIn = 0;
  tokensOut = 0;
  submittedAt: Odt | null = null;
  completedAt: Odt | null = null;
  outputFetchedAt: Odt | null = null;
  error: string | null = null;
  doStatus: string | null = null;
  doRequestCounts: JsonValue | null = null;
  statusChangedAt: Odt | null = null;
  nextAttemptAt: Odt | null = null;
  submitFailures = 0;
  doRequestId: string | null = null;
  part = 1;
  createdAt: Odt | null = null;

  constructor(
    readonly runId: string,
    readonly stage: string,
    readonly attempt: number,
    readonly model: string,
    readonly mode: string,
    readonly requestCount: number,
    readonly payloadKey: string | null,
  ) {}

  withPart(part: number): this {
    this.part = part;
    return this;
  }

  addUsage(tokensIn: number, tokensOut: number, cached: number, cost: Dec): void {
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    this.tokensCached += cached;
    this.costEstimate = (this.costEstimate ?? Dec.ZERO).add(cost);
  }

  finish(status: string, outputKey: string | null, at: Odt, error: string | null): void {
    this.status = status;
    this.outputKey = outputKey;
    this.completedAt = at;
    this.outputFetchedAt = at;
    this.error = error;
  }

  submitted(fileId: string | null, batchId: string | null, at: Odt): void {
    this.doFileId = fileId;
    this.doBatchId = batchId;
    this.submittedAt = at;
    this.status = 'SUBMITTED';
    this.nextAttemptAt = null;
    this.error = null;
  }

  completed(status: string, outputKey: string | null, tokensIn: number, tokensOut: number, at: Odt, error: string | null): void {
    this.status = status;
    this.outputKey = outputKey;
    this.tokensIn = tokensIn;
    this.tokensOut = tokensOut;
    this.completedAt = at;
    this.outputFetchedAt = at;
    this.error = error;
  }

  /** DO's view of the batch (GET /v1/batches/{id}): status and request_counts. */
  observed(doStatus: string | null, requestCounts: JsonValue | null | undefined, at: Odt): void {
    if (doStatus != null && doStatus !== this.doStatus) this.statusChangedAt = at;
    this.doStatus = doStatus;
    if (requestCounts !== undefined && requestCounts !== null) this.doRequestCounts = requestCounts;
  }

  /** A queued batch DO has not accepted yet (created before calling DO). */
  queued(requestId: string): void {
    this.status = 'QUEUED';
    this.doRequestId = requestId;
  }

  /** Batch creation refused for now (429, 5xx, no response): retry at `at`. */
  retryAt(at: Odt, error: string): void {
    this.submitFailures++;
    this.nextAttemptAt = at;
    this.error = error;
  }
}

/**
 * domain/kb/KbRunRequest (wiki.kb_run_request, V35): one LLM request of a run.
 * status: PENDING, SUBMITTED, DONE, FAILED, DEFERRED.
 */
export class KbRunRequest {
  batchJobId: string | null = null;
  status = 'PENDING';
  result: JsonValue | null = null;
  error: string | null = null;
  tokensIn = 0;
  tokensOut = 0;
  tokensCached = 0;
  execPath: string | null = null;
  completedAt: Odt | null = null;
  latencyMs: number | null = null;
  contentFingerprint: string | null = null;
  createdAt: Odt | null = null;

  constructor(
    readonly customId: string,
    readonly runId: string,
    readonly stage: string,
    readonly subjectId: string,
    readonly itemKey: string,
    readonly target: string,
    readonly chunk: number,
    readonly model: string,
    public params: JsonValue,
    readonly estTokens: number,
  ) {}

  /** Sent (again): a resubmission clears the previous attempt's answer time. */
  submitted(batchJobId: string): void {
    this.batchJobId = batchJobId;
    this.status = 'SUBMITTED';
    this.completedAt = null;
    this.latencyMs = null;
  }

  done(result: JsonValue | null, tokensIn: number, tokensOut: number, cached: number, execPath: string | null): void {
    this.status = 'DONE';
    this.result = result;
    this.error = null;
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    this.tokensCached += cached;
    this.execPath = execPath;
  }

  failed(error: string): void {
    this.status = 'FAILED';
    this.error = error;
  }

  /** For the resubmission of an empty/truncated answer (batch mode). */
  doubleMaxTokens(cap: number): void {
    if (isObject(this.params)) {
      const copy = deepCopy(this.params);
      copy.max_tokens = Math.min(cap, asInt(path(this.params, 'max_tokens'), 4096) * 2);
      this.params = copy;
    }
  }

  /** Asked once more with amended params; the next answer replaces the result, tokens add up. */
  redo(params: JsonValue): void {
    this.params = params;
    this.status = 'PENDING';
    this.error = null;
  }

  /** An answer arrived (ok or not): when, and how long the request took (sync). */
  answered(at: Odt, latencyMs: number | null): void {
    this.completedAt = at;
    this.latencyMs = latencyMs;
  }
}

/** domain/kb/KbLlmUsage (wiki.kb_llm_usage): one LLM call, priced when recorded. */
export interface KbLlmUsage {
  createdAt: Odt;
  runId: string | null;
  evalId: string | null;
  requestId: string | null;
  model: string;
  mode: string;
  stage: string;
  subjectId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: Dec;
  simulated: boolean;
  attempt: number;
  latencyMs: number | null;
  reasoningTokens: number | null;
}
