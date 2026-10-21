// Port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbForecastService.java.
//
// Expected costs (docs/SUBJECT-WIKI-ADMIN.md §7), for the current or proposed
// settings. All prices are effective prices: batch-discounted when the stage
// would run in BATCH.
//   nextRun     the pipeline preview (dirty subjects, real sizes) priced;
//               input = chars / 3.5 plus prompt overhead; output = the median
//               output tokens per request learned per (model, stage), else
//               600 / 1500 / 2500 / 2500 (DIGEST / PLAN / WRITE / RETRY)
//   weekly      basis history (>= 3 completed scheduled runs: median run
//               re-priced, p25-p75, times the scheduled runs per week from
//               the cron), corpus (no run: weekly changed files x tokens per
//               file, range x0.5-x1.5) or blend (1-2 runs, weighted runs/3)
//   monthly     weekly x 4.345
//   fullRebuild every wiki regenerated from its digests (PLAN + WRITE)
//   savings     for the typical week: batch (vs list price) and cache (vs uncached input)
// The pure statics (basis, blend, weekly, quantiles, usd, stageModel) are logic/admin/kbForecast.ts.

import { createHash } from 'node:crypto';
import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { toJavaJson } from '../../lib/json';
import { Dec } from '../kb/logic/decimal';
import {
  basis, blend, DEFAULT_OUTPUT, DIGEST_TOKENS_PER_FILE, OVERHEAD, quantiles, stageModel, STAGES, usd, weekly as weeklyOf,
  WEEKS_PER_MONTH, type Weekly,
} from '../kb/logic/admin/kbForecast';
import { values, type KbEffectiveSettings } from '../kb/logic/admin/kbSettings';
import { lowerRoot } from '../kb/logic/javaString';
import { batchByRule, batchProvider } from '../kb/logic/llm/kbChatPayloads';
import { cost } from '../kb/logic/llm/kbPricing';
import { ART_ZONE, type Odt } from '../kb/logic/odt';
import { CHUNK_CHARS, PROMPT_VERSION } from '../kb/logic/pipeline/kbPayloads';
import { completed } from '../kb/logic/pipeline/kbRunOutcome';
import type { KbModel } from '../kb/logic/types';
import * as inputs from '../kb-pipeline/inputs';
import { SpringCron } from './cron';
import * as repo from './repo';
import { kbTx } from './tx';
import { nowOdt } from './values';

export type { Weekly };

export interface Stage { model: string; mode: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; costUsd: Dec }
export interface NextRun { dirtySubjects: number; perStage: Record<string, Stage>; totalUsd: Dec }
export interface Range { expectedUsd: Dec; low: Dec; high: Dec }
export interface Tokens { inputTokens: number; outputTokens: number; costUsd: Dec }
export interface Savings { batchUsd: Dec; cacheUsd: Dec }
export interface Limits { weeklyCostLimitUsd: Dec | null; exceedsLimit: boolean }

/** web/kb/admin/KbForecastResponse. */
export interface KbForecastResponse {
  settingsHash: string;
  nextRun: NextRun;
  weekly: Weekly;
  monthly: Range;
  fullRebuild: Tokens;
  savings: Savings;
  limits: Limits;
  discountIsEstimate: boolean;
}

/** web/kb/admin/KbStageCostResponse. */
export interface KbStageCostResponse {
  stage: string;
  model: string;
  mode: string;
  expectedWeeklyUsd: Dec;
  low: Dec;
  high: Dec;
  basis: string;
}

/** KbForecastService.SubjectEstimate. */
export interface SubjectEstimate { subjectId: string; costUsd: Dec; inputTokens: number }

interface Line { stage: string; model: string; mode: string; input: number; cached: number; output: number }

interface Snapshot {
  current: Map<string, inputs.Input[]>;
  diffs: inputs.Diff[];
  liveSources: Map<string, string[][]>;
  catalog: Map<string, KbModel>;
  /** The catalog KbLlmRouter.modeFor reads: live (the memoized snapshot keeps prices, not modes). */
  modes: Map<string, KbModel>;
  ratios: Map<string, number>;
  cacheRatios: Map<string, number>;
}

const dirtyOf = (snap: Snapshot, s: KbEffectiveSettings): inputs.Diff[] => snap.diffs.filter((d) => d.dirty() && !s.paused(d.subjectId));
const fp = (i: inputs.Input): string => (i.fingerprint != null ? i.fingerprint : 'file:' + i.fileId);
const DAY = 86_400;

/** KbLlmRouter.modeFor over a catalog already read (same rule; no query per line). */
export function modeFor(catalog: Map<string, KbModel>, model: string, executionMode: string): 'BATCH' | 'SYNC' {
  const m = lowerRoot(executionMode);
  const batchCapable = batchProvider(model) != null && (catalog.has(model) ? catalog.get(model)!.isBatchSupported() : batchByRule(model));
  if (m === 'sync') return 'SYNC';
  return batchCapable ? 'BATCH' : 'SYNC';
}

/** Scheduled runs in the 7 days from `from` (at least 1; an invalid cron counts as one run). */
export function runsPerWeek(cron: string | null, from: Odt): number {
  if (cron == null || !SpringCron.isValidExpression(cron)) return 1;
  const expr = SpringCron.parse(cron);
  const n = expr.countFires(from.epochSecond, from.epochSecond + 7 * DAY, from.nano, ART_ZONE, 7 * 24 * 60);
  return Math.max(1, n);
}

/** HexFormat.formatHex(sha256(json), 0, 8): Jackson's JSON of the KbEffectiveSettings record. */
export function settingsHash(s: KbEffectiveSettings): string {
  return createHash('sha256').update(toJavaJson(values(s)), 'utf8').digest('hex').slice(0, 16);
}

export class KbForecastService {
  /** stage-cost is asked for every (model, stage) of the admin table at once: those calls share one snapshot for 30 s. */
  static readonly SNAPSHOT_TTL_MS = 30_000;
  private memo: Snapshot | null = null;
  private memoAt = 0;

  constructor(private readonly deps: Deps) {}

  forecast(s: KbEffectiveSettings): Promise<KbForecastResponse> {
    return kbTx(this.deps.db, async (tx) => this.compute(tx, s, await this.snapshot(tx)));
  }

  /** GET /models/{id}/stage-cost: the weekly forecast with `model` in `stage`, every other setting as `s`. */
  stageCost(s: KbEffectiveSettings, model: string, stage: string): Promise<KbStageCostResponse> {
    return kbTx(this.deps.db, async (tx) => {
      const snap: Snapshot = { ...(await this.memoSnapshot(tx)), modes: await this.catalog(tx) };
      const weekly = (await this.compute(tx, s, snap)).weekly;
      const mode = lowerRoot(modeFor(snap.modes, model, s.executionMode));
      return { stage: lowerRoot(stage), model, mode, expectedWeeklyUsd: weekly.expectedUsd, low: weekly.low, high: weekly.high, basis: weekly.basis };
    });
  }

  /** The forecast's next-run total (stored on a run when it is detected). */
  nextRunTotal(s: KbEffectiveSettings): Promise<Dec> {
    return kbTx(this.deps.db, async (tx) => {
      const snap = await this.snapshot(tx);
      return usd(this.total(await this.nextRunLines(tx, s, snap), snap.catalog));
    });
  }

  /**
   * Each dirty subject's full estimate at the effective prices of `s`: the forecast heuristics,
   * DIGEST for files without a cached digest only (no cross-subject dedupe: an upper bound).
   */
  subjectEstimates(s: KbEffectiveSettings, dirty: inputs.Diff[]): Promise<Map<string, SubjectEstimate>> {
    return kbTx(this.deps.db, async (tx) => {
      const catalog = await this.catalog(tx);
      const snap: Snapshot = {
        current: new Map(), diffs: [], liveSources: await this.liveSources(tx), catalog, modes: catalog,
        ratios: await this.outputRatios(tx), cacheRatios: await this.cacheRatios(tx),
      };
      const known = await this.knownDigests(tx, dirty);
      const out = new Map<string, SubjectEstimate>();
      for (const d of dirty) {
        const lines = this.subjectLines(s, snap, d, known, new Set());
        out.set(d.subjectId, { subjectId: d.subjectId, costUsd: this.total(lines, snap.catalog), inputTokens: lines.reduce((a, l) => a + l.input, 0) });
      }
      return out;
    });
  }

  // ---- the forecast ---------------------------------------------------------------

  private async compute(tx: Db, s: KbEffectiveSettings, snap: Snapshot): Promise<KbForecastResponse> {
    const catalog = snap.catalog;
    const next = await this.nextRunLines(tx, s, snap);
    const nextStages = this.perStage(next, s, catalog, snap.modes);
    const nextTotal = this.total(next, catalog);

    const history = await this.historyCosts(tx, s, catalog, snap.modes);
    const corpusLines = await this.corpusLines(tx, s, snap);
    const corpus = this.total(corpusLines, catalog);
    const b = basis(history.length);
    const hist = quantiles(history);
    // History is per run: a week has as many runs as the cron fires.
    const perWeek = Dec.fromInt(runsPerWeek(s.cron, nowOdt(this.deps)));
    for (let i = 0; i < hist.length; i++) hist[i] = hist[i]!.multiply(perWeek);
    let expected: Dec;
    let low: Dec;
    let high: Dec;
    const half = Dec.parse('0.5');
    const oneAndHalf = Dec.parse('1.5');
    if (b === 'history') {
      expected = hist[1];
      low = hist[0];
      high = hist[2];
    } else if (b === 'corpus') {
      expected = corpus;
      low = corpus.multiply(half);
      high = corpus.multiply(oneAndHalf);
    } else {
      const w = Dec.fromInt(history.length).divide(Dec.fromInt(3), 6, 'HALF_UP');
      expected = blend(hist[1], corpus, w);
      low = blend(hist[0], corpus.multiply(half), w);
      high = blend(hist[2], corpus.multiply(oneAndHalf), w);
    }
    const dirty = dirtyOf(snap, s).length;
    const floor = dirty > 0 ? nextTotal : Dec.ZERO;
    const monthly: Range = {
      expectedUsd: usd(expected.multiply(WEEKS_PER_MONTH).max(floor)),
      low: usd(low.multiply(WEEKS_PER_MONTH).max(floor)),
      high: usd(high.multiply(WEEKS_PER_MONTH).max(floor)),
    };
    const weekly = weeklyOf(expected, low, high, floor, b, history.length);

    const rebuild = this.rebuildLines(s, snap);
    const fullRebuild: Tokens = {
      inputTokens: rebuild.reduce((a, l) => a + l.input, 0),
      outputTokens: rebuild.reduce((a, l) => a + l.output, 0),
      costUsd: usd(this.total(rebuild, catalog)),
    };

    // Savings on the typical week's profile (history if any, else corpus).
    const profile = history.length === 0 ? corpusLines : await this.historyProfile(tx, s, catalog, snap.modes);
    const actual = this.total(profile, catalog);
    let noBatch = Dec.ZERO;
    let noCache = Dec.ZERO;
    for (const l of profile) {
      const m = catalog.get(l.model) ?? null;
      noBatch = noBatch.add(cost(m, 'SYNC', l.input, l.cached, l.output));
      noCache = noCache.add(cost(m, l.mode, l.input, 0, l.output));
    }
    const savings: Savings = {
      batchUsd: usd(noBatch.subtract(actual).max(Dec.ZERO)),
      cacheUsd: usd(noCache.subtract(actual).max(Dec.ZERO)),
    };

    const limit = s.weeklyCostLimitUsd;
    const exceeds = limit != null && (nextTotal.compareTo(limit) > 0 || weekly.expectedUsd.compareTo(limit) > 0);
    const discountIsEstimate = STAGES.some((st) => {
      const model = stageModel(s, st, null);
      const m = catalog.get(model);
      return modeFor(snap.modes, model, s.executionMode) === 'BATCH' && (m == null || !m.batchDiscountVerified);
    });
    return {
      settingsHash: settingsHash(s),
      nextRun: { dirtySubjects: dirty, perStage: nextStages, totalUsd: usd(nextTotal) },
      weekly,
      monthly,
      fullRebuild,
      savings,
      limits: { weeklyCostLimitUsd: limit, exceedsLimit: exceeds },
      discountIsEstimate,
    };
  }

  // ---- snapshot -------------------------------------------------------------------

  private async snapshot(tx: Db): Promise<Snapshot> {
    const current = await inputs.current();
    const catalog = await this.catalog(tx);
    return {
      current,
      diffs: await inputs.diffs(() => false, current),
      liveSources: await this.liveSources(tx),
      catalog,
      modes: catalog,
      ratios: await this.outputRatios(tx),
      cacheRatios: await this.cacheRatios(tx),
    };
  }

  private async memoSnapshot(tx: Db): Promise<Snapshot> {
    const now = performance.now();
    if (this.memo != null && now - this.memoAt < KbForecastService.SNAPSHOT_TTL_MS) return this.memo;
    const m = await this.snapshot(tx);
    this.memo = m;
    this.memoAt = now;
    return m;
  }

  private async liveSources(tx: Db): Promise<Map<string, string[][]>> {
    const out = new Map<string, string[][]>();
    for (const r of await repo.subjectSources(tx, ['PUBLISHED', 'HIDDEN'])) {
      let l = out.get(r.subjectId);
      if (!l) out.set(r.subjectId, (l = []));
      l.push(r.sources);
    }
    return out;
  }

  private async catalog(tx: Db): Promise<Map<string, KbModel>> {
    const out = new Map<string, KbModel>();
    for (const m of await repo.allModels(tx)) out.set(m.id, m);
    return out;
  }

  // ---- token profiles -------------------------------------------------------------

  private async nextRunLines(tx: Db, s: KbEffectiveSettings, snap: Snapshot): Promise<Line[]> {
    const lines: Line[] = [];
    const dirty = dirtyOf(snap, s);
    const known = await this.knownDigests(tx, dirty);
    const planned = new Set<string>();
    for (const d of dirty) lines.push(...this.subjectLines(s, snap, d, known, planned));
    return lines;
  }

  /** Fingerprints among the added/changed files of `dirty` that already have a full digest. */
  private async knownDigests(tx: Db, dirty: inputs.Diff[]): Promise<Set<string>> {
    const fps = new Set<string>();
    for (const d of dirty) {
      for (const i of d.added) fps.add(fp(i));
      for (const i of d.changed) fps.add(fp(i));
    }
    const known = new Set<string>();
    if (fps.size > 0) {
      for (const dg of await repo.digestsByFingerprint(tx, [...fps], PROMPT_VERSION)) if (!dg.partial) known.add(dg.fingerprint);
    }
    return known;
  }

  /** One subject's end-to-end token profile: DIGEST of files without a digest, then PLAN, WRITE and RETRY. */
  private subjectLines(s: KbEffectiveSettings, snap: Snapshot, d: inputs.Diff, known: Set<string>, planned: Set<string>): Line[] {
    const lines: Line[] = [];
    const subject = d.subjectId;
    let changedChars = 0;
    let changedFiles = 0;
    for (const list of [d.added, d.changed]) {
      for (const i of list) {
        changedChars += i.chars;
        changedFiles++;
        const f = fp(i);
        if (known.has(f) || planned.has(f)) continue;
        planned.add(f);
        const chunks = Math.max(1, Math.ceil(i.chars / CHUNK_CHARS));
        lines.push(this.line(s, snap, 'DIGEST', null, chunks, Math.trunc(i.chars / 3.5) + OVERHEAD * chunks));
      }
    }
    const live = snap.liveSources.get(subject) ?? [];
    const pageCount = live.length;
    lines.push(this.line(s, snap, 'PLAN', subject, 1, OVERHEAD + 150 * pageCount + DIGEST_TOKENS_PER_FILE * changedFiles + 1500));
    const touched = new Set<string>([...d.changed.map((i) => i.fileId), ...d.removed]);
    const citing = live.filter((src) => src.some((id) => touched.has(id))).length;
    const writes = citing + (d.added.length === 0 ? 0 : Math.max(1, Math.trunc(d.added.length / 2))) + (pageCount === 0 ? 1 : 0);
    if (writes === 0) return lines;
    const excerpts = Math.min(12_000, Math.trunc(changedChars / 3.5));
    const perWrite = OVERHEAD + 1500 + 100 * pageCount + excerpts + 800 * Math.min(changedFiles, 5) + 2000;
    lines.push(this.line(s, snap, 'WRITE', subject, writes, perWrite * writes));
    const retries = Math.ceil(writes * 0.15);
    lines.push(this.line(s, snap, 'RETRY', subject, retries, (perWrite + 4000) * retries));
    return lines;
  }

  /** Weekly change rate of published files (drive modifiedTime in the last 28 days / 4) x the average tokens per file. */
  private async corpusLines(tx: Db, s: KbEffectiveSettings, snap: Snapshot): Promise<Line[]> {
    let fileCount = 0;
    let chars = 0;
    for (const list of snap.current.values()) {
      for (const i of list) {
        fileCount++;
        chars += i.chars;
      }
    }
    if (fileCount === 0) return [];
    const avgTokens = chars / 3.5 / fileCount;
    const changed = await repo.countPublishedModifiedSince(tx, nowOdt(this.deps).plusSeconds(-28 * DAY));
    const perWeek = changed / 4.0;
    if (perWeek <= 0) return [];
    const n = Math.ceil(perWeek);
    const lines: Line[] = [];
    lines.push(this.line(s, snap, 'DIGEST', null, n, Math.trunc((avgTokens + OVERHEAD) * n)));
    lines.push(this.line(s, snap, 'PLAN', null, n, (OVERHEAD + 3000 + DIGEST_TOKENS_PER_FILE) * n));
    lines.push(this.line(s, snap, 'WRITE', null, n, Math.trunc((OVERHEAD + 5000 + Math.min(12_000, avgTokens)) * n)));
    const retries = Math.ceil(n * 0.15);
    lines.push(this.line(s, snap, 'RETRY', null, retries, Math.trunc((OVERHEAD + 9000 + Math.min(12_000, avgTokens)) * retries)));
    return lines;
  }

  /** Every wiki regenerated from its digests. */
  private rebuildLines(s: KbEffectiveSettings, snap: Snapshot): Line[] {
    const lines: Line[] = [];
    for (const [subject, list] of snap.current) {
      const fileCount = list.length;
      const chars = list.reduce((a, i) => a + i.chars, 0);
      const pageCount = Math.max(fileCount + 1, (snap.liveSources.get(subject) ?? []).length);
      lines.push(this.line(s, snap, 'PLAN', subject, 1, OVERHEAD + 1500 + DIGEST_TOKENS_PER_FILE * fileCount));
      const perWrite = OVERHEAD + 1500 + 100 * pageCount + Math.min(12_000, Math.trunc(chars / 3.5 / pageCount)) + 2400;
      lines.push(this.line(s, snap, 'WRITE', subject, pageCount, perWrite * pageCount));
    }
    return lines;
  }

  private line(s: KbEffectiveSettings, snap: Snapshot, stage: string, subjectId: string | null, requestCount: number, input: number): Line {
    const model = stageModel(s, stage, subjectId);
    const mode = modeFor(snap.modes, model, s.executionMode);
    const output = (snap.ratios.get(model + '|' + stage) ?? DEFAULT_OUTPUT[stage]!) * requestCount;
    const cached = Math.trunc(input * (snap.cacheRatios.get(model) ?? 0));
    return { stage, model, mode, input, cached, output };
  }

  private perStage(lines: Line[], s: KbEffectiveSettings, catalog: Map<string, KbModel>, modes: Map<string, KbModel>): Record<string, Stage> {
    const out: Record<string, Stage> = {};
    for (const st of STAGES) {
      let input = 0;
      let cached = 0;
      let outTokens = 0;
      let c = Dec.ZERO;
      for (const l of lines) {
        if (l.stage !== st) continue;
        input += l.input;
        cached += l.cached;
        outTokens += l.output;
        c = c.add(cost(catalog.get(l.model) ?? null, l.mode, l.input, l.cached, l.output));
      }
      const model = stageModel(s, st, null);
      out[st] = { model, mode: lowerRoot(modeFor(modes, model, s.executionMode)), inputTokens: input, cachedInputTokens: cached, outputTokens: outTokens, costUsd: usd(c) };
    }
    return out;
  }

  private total(lines: Line[], catalog: Map<string, KbModel>): Dec {
    let t = Dec.ZERO;
    for (const l of lines) t = t.add(cost(catalog.get(l.model) ?? null, l.mode, l.input, l.cached, l.output));
    return t;
  }

  // ---- history ----------------------------------------------------------------------

  private async recentScheduled(tx: Db): Promise<repo.RunHead[]> {
    return (await repo.runsNotTriggered(tx, 'EVAL', 50)).filter((r) => r.trigger === 'SCHEDULED' && completed(r.status)).slice(0, 8);
  }

  /** Each recent scheduled run's recorded usage, re-priced with `s`. */
  private async historyCosts(tx: Db, s: KbEffectiveSettings, catalog: Map<string, KbModel>, modes: Map<string, KbModel>): Promise<Dec[]> {
    const recent = await this.recentScheduled(tx);
    if (!recent.length) return [];
    const byRun = new Map<string, Dec>();
    for (const r of recent) byRun.set(r.id, Dec.ZERO);
    for (const u of await repo.usageOfRuns(tx, [...byRun.keys()])) {
      const l = this.reprice(u, s, modes);
      byRun.set(u.runId!, byRun.get(u.runId!)!.add(cost(catalog.get(l.model) ?? null, l.mode, l.input, l.cached, l.output)));
    }
    return [...byRun.values()];
  }

  /** The token profile of the median recent scheduled run, re-priced with `s`. */
  private async historyProfile(tx: Db, s: KbEffectiveSettings, catalog: Map<string, KbModel>, modes: Map<string, KbModel>): Promise<Line[]> {
    const recent = await this.recentScheduled(tx);
    if (!recent.length) return [];
    const byRun = new Map<string, Line[]>();
    for (const u of await repo.usageOfRuns(tx, recent.map((r) => r.id))) {
      let l = byRun.get(u.runId!);
      if (!l) byRun.set(u.runId!, (l = []));
      l.push(this.reprice(u, s, modes));
    }
    const ranked = [...byRun.values()].sort((a, b) => this.total(a, catalog).compareTo(this.total(b, catalog)));
    return ranked.length === 0 ? [] : ranked[Math.trunc(ranked.length / 2)]!;
  }

  private reprice(u: repo.UsageRow, s: KbEffectiveSettings, modes: Map<string, KbModel>): Line {
    const model = stageModel(s, u.stage, u.subjectId);
    return { stage: u.stage, model, mode: modeFor(modes, model, s.executionMode), input: u.inputTokens, cached: u.cachedInputTokens, output: u.outputTokens };
  }

  // ---- learned ratios -----------------------------------------------------------------

  /** Median output tokens per request, per "model|stage", over recent answers. */
  private async outputRatios(tx: Db): Promise<Map<string, number>> {
    const samples = new Map<string, number[]>();
    for (const r of await repo.recentOutputTokens(tx, nowOdt(this.deps).plusSeconds(-90 * DAY))) {
      const k = r.model + '|' + r.stage;
      let l = samples.get(k);
      if (!l) samples.set(k, (l = []));
      l.push(r.out);
    }
    const out = new Map<string, number>();
    for (const [k, v] of samples) {
      v.sort((a, b) => a - b);
      out.set(k, v[Math.trunc(v.length / 2)]!);
    }
    return out;
  }

  /** Share of input tokens served from the provider's cache, per model. */
  private async cacheRatios(tx: Db): Promise<Map<string, number>> {
    const acc = new Map<string, [number, number]>();
    const now = nowOdt(this.deps);
    for (const u of await repo.usageBetween(tx, now.plusSeconds(-30 * DAY), now)) {
      let a = acc.get(u.model);
      if (!a) acc.set(u.model, (a = [0, 0]));
      a[0] += u.inputTokens;
      a[1] += u.cachedInputTokens;
    }
    const out = new Map<string, number>();
    for (const [k, a] of acc) out.set(k, a[0] === 0 ? 0 : a[1] / a[0]);
    return out;
  }
}
