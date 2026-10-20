// Partial port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbModelCatalogService.java:
// probes (sync and batch, with the batch model id fallback and the 429 retry), the
// pending-probe poller, and the pure helpers (batchUnsupported, mergeProbe, provider).
//
// A probe is one tiny structured-output request through the model's execution mode.
// Batch probes (ADMIN doc §6) send the JSONL with the model's batch id (batchModelId,
// else the catalog id without its provider prefix). DO answers asynchronously, so the
// probe stays pending until the poller sees the batch finished; at most one pending
// batch probe per model. If DO says the model id is unsupported, the probe retries
// once with the other form (native <-> prefixed) and stores whichever works in
// batchModelId; batchSupported turns false only when both forms are unsupported. A
// rate-limited (429) or unanswered creation is retried on the poller (1, 5, 15, 60 min).
// Any other error is a failed probe that leaves batchSupported alone.
//
// TODO(kb-service): list (emptyToolCallStats), update/create/apply (price history rows),
// sync()/applyCatalog/syncIds (DoModelCatalog fetch, KbModelPriceHistory), view() ->
// KbModelResponse (needs settings.effective()). probe() here returns the stored model;
// the service maps it with view().

import { ResourceNotFoundError, ValidationError } from '../../../../http/errors';
import { classify, classifyFailure, unsupportedModel } from '../external/doBatchErrors';
import { DoBatchSlotError, LlmApiError } from '../external/llmApi';
import type { LlmResult } from '../external/llmOutputParser';
import { jHashCode, jIsBlank, jTrim, upperRoot } from '../javaString';
import {
  asBoolean,
  asInt,
  asText,
  deepCopy,
  elements,
  fields,
  has,
  hasNonNull,
  isObject,
  path,
  size,
  type JsonObject,
  type JsonValue,
  type Node,
} from '../jsonNode';
import { ART_ZONE, formatHHmm, Odt, type Now } from '../odt';
import type { KbModelStore, Tx } from '../ports';
import type { KbModel } from '../types';
import type { BatchLlmExecutor } from '../llm/batchLlmExecutor';
import { batchProvider, defaultBatchModelId, otherBatchModelId } from '../llm/kbChatPayloads';
import { PREFIX } from '../llm/kbEndpointRegistry';
import type { KbLlmRouter } from '../llm/kbLlmRouter';
import type { KbUsageRecorder } from '../llm/kbUsageRecorder';
import type { LlmLine, SyncLlmExecutor } from '../llm/syncLlmExecutor';
import { backoffMinutes } from '../pipeline/kbBatchSubmitter';
import type { KbPayloads } from '../pipeline/kbPayloads';
import { KbPipelineError } from '../pipeline/kbPipelineError';
import type { KbEffectiveSettings } from './kbSettings';

/**
 * A batch probe error that says the model or provider has no batch support (a 4xx
 * whose code or message says so). Everything else (bad file name, account blocked,
 * rate limit, 5xx) is just a failed probe.
 */
export function batchUnsupported(status: number, message: string | null): boolean {
  if (status < 400 || status >= 500 || status === 429) return false;
  return unsupportedModel(message);
}

/** lastProbe keeps one entry per mode (sync, batch); its top level is the most recent probe (ADMIN doc §6 shape). */
export function mergeProbe(previous: Node, probe: JsonObject): JsonObject {
  const out = deepCopy(probe);
  delete out.sync;
  delete out.batch;
  for (const mode of ['sync', 'batch']) {
    let entry: Node = null;
    if (previous != null) {
      if (has(previous, mode) && isObject(path(previous, mode))) entry = path(previous, mode)!;
      else if (!has(previous, 'sync') && !has(previous, 'batch') && mode === asText(path(previous, 'mode'), '')) {
        entry = previous; // stored before per-mode probes
      }
    }
    if (mode === asText(path(probe, 'mode'))) entry = probe;
    if (entry != null) {
      const copy = deepCopy(entry);
      if (isObject(copy)) {
        delete copy.sync;
        delete copy.batch;
      }
      out[mode] = copy;
    }
  }
  return out;
}

export function provider(id: string): string {
  const p = batchProvider(id);
  if (p != null) return p;
  if (id.startsWith(PREFIX)) return 'custom';
  if (id.startsWith('glm')) return 'zhipu';
  if (id.startsWith('deepseek')) return 'deepseek';
  return 'do';
}

/** LocalTime.toString() of an instant in Buenos Aires, truncated to minutes ("04:30"). */
const localHHmm = (t: Odt): string => formatHHmm(t, ART_ZONE);

const millisBetween = (a: Odt, b: Odt): number => a.millisUntil(b);

export interface SettingsSource {
  effective(): Promise<KbEffectiveSettings> | KbEffectiveSettings;
}

export class KbModelCatalogService {
  constructor(
    private readonly models: KbModelStore,
    private readonly settings: SettingsSource | null,
    private readonly router: KbLlmRouter,
    private readonly sync: SyncLlmExecutor | null,
    private readonly batch: BatchLlmExecutor,
    private readonly payloads: KbPayloads,
    private readonly usage: KbUsageRecorder,
    private readonly tx: Tx,
    private readonly now: Now,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private async load(id: string): Promise<KbModel> {
    const m = await this.models.findById(id);
    if (m == null) throw new ResourceNotFoundError('KbModel', id);
    return m;
  }

  /** One tiny structured-output request through the model's mode (or the given one: batch | sync). */
  async probe(id: string, modeOverride: string | null): Promise<KbModel> {
    const model = await this.tx(() => this.load(id));
    let mode: string;
    if (modeOverride == null || jIsBlank(modeOverride)) {
      mode = await this.router.modeFor(id, (await this.settings!.effective()).executionMode);
    } else {
      mode = upperRoot(jTrim(modeOverride));
      if (mode !== 'BATCH' && mode !== 'SYNC') throw new ValidationError('mode', modeOverride, 'must be batch or sync');
      if (mode === 'BATCH' && batchProvider(id) == null) {
        throw new ValidationError('mode', modeOverride, 'DO batches only take anthropic-*/openai-* models');
      }
    }
    if (!this.router.availableIn(id, mode)) {
      throw new KbPipelineError('LLM_UNCONFIGURED', 'Inference is not configured (KB_LLM_API_KEY)');
    }
    const started = this.now();
    if (mode === 'BATCH') {
      const current = model.probeIn('batch');
      if (current != null && asBoolean(path(current, 'pending'), false)) {
        this.log(`KB catalog: batch probe of ${id} already pending; not submitting another`);
        return this.tx(() => this.load(id));
      }
      const first = model.getBatchModelId() ?? defaultBatchModelId(id)!;
      return this.saveBatchProbe(id, await this.submitBatchProbe(id, first, [], undefined, started, 0), null);
    }
    const line = await this.probeLine(id);
    const probe: JsonObject = { mode: 'sync', at: started.toString() };
    const res = await this.sync!.runOne(line);
    this.fill(probe, res, millisBetween(started, this.now()));
    await this.recordUsage(id, mode, res);
    return this.tx(async () => {
      const m = await this.load(model.id);
      m.lastProbe = mergeProbe(m.lastProbe, probe);
      updateToolCalling(m, probe);
      return this.models.save(m); // no unit of work: every mutated entity is saved (ports.ts)
    });
  }

  private async probeLine(id: string): Promise<LlmLine> {
    const params = await this.payloads.tuned(
      id,
      'DIGEST',
      4000,
      'low',
      null,
      'Archivo: prueba.txt (parte 1/1)\n\nEl interés compuesto capitaliza los intereses de cada período: M = C (1 + i)^n.',
    );
    const h = jHashCode(id);
    return { customId: 'probe-' + (h === -2147483648 ? h : Math.abs(h)), params };
  }

  /**
   * Submits one batch probe of `id` with `batchModelId` in the JSONL. tried: the forms
   * DO already refused as unsupported; triedErrors: DO's error per refused form;
   * retries: refused creations so far (back-off). The result is the probe entry to
   * store: pending {batchId} or {retryAt}, or finished (ok false).
   */
  async submitBatchProbe(id: string, batchModelId: string, tried: string[], triedErrors: Node, started: Odt, retries: number): Promise<JsonObject> {
    const probe: JsonObject = {};
    if (triedErrors != null && size(triedErrors) > 0) probe.triedErrors = deepCopy(triedErrors);
    probe.mode = 'batch';
    probe.at = started.toString();
    probe.batchModelId = batchModelId;
    probe.tried = [...tried];
    const now = this.now();
    try {
      const submitted = await this.batch.submit(`kb-probe-${id}`, id, batchModelId, [await this.probeLine(id)], `kb-probe-${id}-${now.epochSecond}`);
      probe.ok = false;
      probe.pending = true;
      probe.batchId = submitted.batchId;
      noAnswer(probe, millisBetween(started, now));
      return probe;
    } catch (e) {
      if (!(e instanceof LlmApiError)) throw e;
      const kind = classify(e.status, e.message);
      probe.ok = false;
      noAnswer(probe, millisBetween(started, this.now()));
      switch (kind) {
        case 'RATE_LIMITED':
        case 'TRANSIENT': {
          const slot = e instanceof DoBatchSlotError ? e : null;
          const hourly = String(e.message).includes('batch_creations_per_hour');
          const at = slot != null ? slot.retryAt : now.plusMinutes(hourly ? 60 : backoffMinutes(retries + 1));
          probe.pending = true;
          probe.retryAt = at.toString();
          probe.retries = retries + 1;
          probe.error =
            slot != null
              ? slot.message.replace(' (rate_limit_exceeded)', '') + '; reintento a las ' + localHHmm(at)
              : (kind === 'RATE_LIMITED'
                  ? 'DigitalOcean limitó la creación de lotes; reintento a las '
                  : 'DigitalOcean no respondió al crear el lote; reintento a las ') +
                localHHmm(at) + ' (' + e.message + ')';
          this.log(`KB catalog: batch probe of ${id} refused (${e.message}); retry at ${at.toString()}`);
          return probe;
        }
        case 'UNSUPPORTED_MODEL':
          return this.unsupported(id, batchModelId, tried, started, e.message, probe);
        default:
          probe.error = 'batch rejected: ' + e.message;
          return probe;
      }
    }
  }

  /** DO refused `batchModelId` as unsupported: the other form if untried, else a finished probe marked unsupportedModel. */
  private async unsupported(id: string, batchModelId: string, tried: string[], started: Odt, error: string | null, probe: JsonObject): Promise<JsonObject> {
    const triedNow = [...tried];
    if (!triedNow.includes(batchModelId)) triedNow.push(batchModelId);
    if (!isObject(probe.triedErrors)) probe.triedErrors = {};
    const errors = probe.triedErrors as JsonObject;
    errors[batchModelId] = error;
    const other = otherBatchModelId(id, batchModelId);
    if (other != null && !triedNow.includes(other)) {
      this.log(`KB catalog: batch probe of ${id}: ${batchModelId} unsupported (${error}), retrying with ${other}`);
      return this.submitBatchProbe(id, other, triedNow, errors, started, 0);
    }
    probe.tried = triedNow;
    delete probe.pending;
    probe.ok = false;
    probe.unsupportedModel = true;
    // DO's own words per id form.
    probe.error =
      'batch not available for this model on DigitalOcean: ' +
      fields(errors).map(([k, v]) => `${k}: ${asText(v)}`).join('; ');
    return probe;
  }

  /**
   * Stores a batch probe entry: unsupportedModel (every id form refused) sets
   * batchSupported false; a successful one sets it true and keeps the id that worked.
   */
  private saveBatchProbe(id: string, probe: JsonObject, worked: boolean | null): Promise<KbModel> {
    return this.tx(async () => {
      const m = await this.load(id);
      m.lastProbe = mergeProbe(m.lastProbe, probe);
      updateToolCalling(m, probe);
      const now = this.now();
      if (worked === true) {
        m.setBatchFromProbe(true, now);
        const used = asText(path(probe, 'batchModelId'), null);
        if (used != null) m.setBatchModelId(used);
      } else if (asBoolean(path(probe, 'unsupportedModel'), false)) {
        m.setBatchFromProbe(false, now);
      }
      return this.models.save(m); // no unit of work: every mutated entity is saved (ports.ts)
    });
  }

  /** Finishes BATCH probes whose batch is done, and resubmits refused creations once due (KbPipelineJob). */
  async refreshPendingProbes(): Promise<void> {
    const pending = await this.tx(async () =>
      (await this.models.findAll())
        .filter((m) => m.probeIn('batch') != null && asBoolean(path(m.probeIn('batch'), 'pending'), false))
        .map((m) => m.id),
    );
    for (const id of pending) {
      try {
        await this.refreshProbe(id);
      } catch (e) {
        this.log(`KB catalog: probe of ${id} not refreshed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private async refreshProbe(id: string): Promise<void> {
    const m = await this.tx(() => this.load(id));
    const p = m.probeIn('batch')!;
    const started = Odt.parse(asText(path(p, 'at')));
    const batchModelId = asText(path(p, 'batchModelId'), null) ?? defaultBatchModelId(id)!;
    const tried = elements(path(p, 'tried')).map((t) => asText(t));
    if (!hasNonNull(p, 'batchId')) {
      // A refused creation, retried when due.
      const retryAt = hasNonNull(p, 'retryAt') ? Odt.parse(asText(path(p, 'retryAt'))) : null;
      if (retryAt != null && this.now().isBefore(retryAt)) return;
      await this.saveBatchProbe(
        id,
        await this.submitBatchProbe(id, batchModelId, tried, path(p, 'triedErrors'), started, asInt(path(p, 'retries'), 0)),
        null,
      );
      return;
    }
    const batchId = asText(path(p, 'batchId'));
    const info = await this.batch.poll(batchId);
    if (!info.finished()) return;
    const probe: JsonObject = { mode: 'batch', at: started.toString(), batchId, batchModelId, tried: [...tried] };
    if (size(path(p, 'triedErrors')) > 0) probe.triedErrors = deepCopy(path(p, 'triedErrors')!);
    if (info.status === 'failed' && info.errorMessage != null && classifyFailure(info.errorMessage) === 'UNSUPPORTED_MODEL') {
      noAnswer(probe, millisBetween(started, this.now()));
      await this.saveBatchProbe(id, await this.unsupported(id, batchModelId, tried, started, info.errorMessage, probe), null);
      return;
    }
    const collected = await this.batch.collect(batchId, info.status === 'completed');
    const res: LlmResult | null = collected.results.values().next().value ?? null;
    if (res == null) {
      probe.ok = false;
      probe.error = 'batch ' + info.status + (info.errorMessage == null ? ' without results' : ': ' + info.errorMessage);
      noAnswer(probe, millisBetween(started, this.now()));
    } else {
      this.fill(probe, res, millisBetween(started, this.now()));
      await this.recordUsage(id, 'BATCH', res);
    }
    await this.saveBatchProbe(id, probe, res != null && res.ok);
    this.log(`KB catalog: batch probe of ${id} with ${batchModelId}: ${res != null && res.ok ? 'ok' : asText(path(probe, 'error'))}`);
  }

  private fill(probe: JsonObject, res: LlmResult, latencyMs: number): void {
    const structured = res.ok && res.toolInput != null && has(res.toolInput, 'topics');
    probe.ok = structured;
    probe.toolCalling = res.path === 'tool' ? 'yes' : 'no';
    probe.path = res.path;
    probe.latencyMs = latencyMs;
    probe.usage = { inputTokens: res.tokensIn, cachedInputTokens: res.cachedTokens, outputTokens: res.tokensOut };
    if (res.error != null) probe.error = res.error;
    else if (!structured) probe.error = `no structured answer (path ${res.path})`;
  }

  private async recordUsage(model: string, mode: string, res: LlmResult): Promise<void> {
    if (res.tokensIn === 0 && res.tokensOut === 0) return;
    await this.tx(() => this.usage.record(null, null, null, model, mode, 'PROBE', null, res.tokensIn, res.cachedTokens, res.tokensOut));
  }
}

/** lastProbe always carries the ADMIN doc §6 fields: without an answer, toolCalling "no", the latency and zero usage. */
function noAnswer(probe: JsonObject, latencyMs: number): void {
  probe.toolCalling = 'no';
  probe.latencyMs = latencyMs;
  probe.usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
}

function updateToolCalling(m: KbModel, probe: JsonValue): void {
  if (asBoolean(path(probe, 'pending'), false)) return;
  if (asText(path(probe, 'toolCalling'), '') === 'yes') m.toolCalling = 'yes';
  else if (asBoolean(path(probe, 'ok'), false)) m.toolCalling = 'no';
}
