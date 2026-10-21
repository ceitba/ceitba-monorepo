// Port of apps/api/src/main/java/org/ceitba/api/service/kb/eval/KbEvalService.java.
//
// The evaluation framework (docs/SUBJECT-WIKI-ADMIN.md §4, §6, §8).
//
// Benchmark sets freeze their subjects' inputs: file ids, fingerprints and
// digests in kb_eval_set.frozen_inputs, and each file's text in storage
// (kb/evals/sets/<setId>/<fileId>.txt), so later evals of the set read
// neither Drive nor the live database text. An eval is a kb_run (trigger
// EVAL) run by KbRunEngine through the same executors, as a full rebuild
// per model configuration:
//
//   DETECT -> DIGEST (only digests the set still lacks, once, shared)
//          -> PLAN (config x subject) -> WRITE (config x subject x page)
//          -> RETRY (rejected pages, one round) -> REPORT (metrics, pages
//             stored under kb/evals/<evalId>/<configKey>/<subject>/<slug>.md)
//
// It never publishes. Its tokens are recorded with stage EVAL. It is the
// explicit, staff-triggered exception to the "no re-reading" rule (it only
// re-sends digests and the frozen excerpts).

import { createHash } from 'node:crypto';
import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { parseJavaUuid } from '../../http/validation';
import { Dec } from '../kb/logic/decimal';
import { compute as computeMetrics, PageInput, type Usage } from '../kb/logic/eval/kbEvalMetrics';
import { configKey } from '../kb/logic/eval/kbEvalKeys';
import { jIsBlank, lowerRoot, upperRoot } from '../kb/logic/javaString';
import {
  asBoolean, asDouble, asInt, asLong, asText, canConvertToInt, decimalValue, deepCopy, elements, fields, has, hasNonNull,
  isArray, isEmpty, isNull, isObject, isTextual, JDouble, nodeToString, path, size, type JsonObject, type JsonValue, type Node,
} from '../kb/logic/jsonNode';
import * as linker from '../kb/logic/kbLinker';
import * as mustCover from '../kb/logic/kbMustCover';
import * as pageParser from '../kb/logic/kbPageParser';
import { sourceInfo, validate as validatePage, type SourceInfo } from '../kb/logic/kbValidator';
import * as wikilinks from '../kb/logic/kbWikilinks';
import { isCustom } from '../kb/logic/llm/kbEndpointRegistry';
import { cost as priceOf } from '../kb/logic/llm/kbPricing';
import type { Odt } from '../kb/logic/odt';
import { merge as mergeDigests } from '../kb/logic/pipeline/kbDigests';
import * as pageFiles from '../kb/logic/pipeline/kbPageFiles';
import { chunks as chunkText, excerpts as excerptsOf, PROMPT_VERSION, type SourceText } from '../kb/logic/pipeline/kbPayloads';
import { correction, EMPTY_PLAN_ERROR, INDEX_ONLY_ERROR, KbPlanCheck, normalizeIndexSlug, DELETE_IGNORED, DUPLICATE_SLUG, INVALID_SLUG } from '../kb/logic/pipeline/kbPlanCheck';
import { KbPipelineError } from '../kb/logic/pipeline/kbPipelineError';
import { completed, status as outcomeOf } from '../kb/logic/pipeline/kbRunOutcome';
import { subset, type Row as ProgressRow, type Run as ProgressRun } from '../kb/logic/progress/kbProgressMath';
import type { KbModel, KbPageType, KbRunRequest } from '../kb/logic/types';
import { KbFileDigest, KbRun, jvmNow } from '../kb-pipeline/db/entities';
import { digests as digestRepo, pages as pageRepo, relations as relationRepo, requests as requestRepo, runs as runRepo } from '../kb-pipeline/db/repo';
import { ACTIVE, Seq, type KbRunHandler } from '../kb-pipeline/engine';
import { kbReader } from '../kb-reader/services';
import * as inputs from '../kb-pipeline/inputs';
import * as er from './evalRepo';
import { modeFor } from './forecast';
import type { KbSettingsResponse, KbSettingsService } from './settings';
import type { PipelineBeans } from './pipeline';
import * as repo from './repo';
import { kbTx } from './tx';
import { nowOdt } from './values';
import { javaTrim } from '../../lib/javaCompat';

export const DEFAULT_SET = 'Básico';
export const DEFAULT_SUBJECTS = ['81.07', '61.81', '93.39'];
export const SMALL_SAMPLE = 20;
const EFFORTS = ['low', 'medium', 'high'];

// ---- DTOs (web/kb/admin/KbEvalDtos, record component order) -----------------------------

export interface FrozenSubject { subjectId: string; subjectName: string | null; files: number; chars: number; digestsMissing: number }
export interface EvalSet { id: string; name: string; subjectIds: string[]; createdBy: string | null; createdAt: Odt; frozenAt: Odt | null; frozen: FrozenSubject[] | null }
export interface ConfigProgress { done: number; total: number; percent: JDouble; stage: string | null }
export interface PageResult { slug: string; title: string | null; valid: boolean; firstPassValid: boolean; errors: string[] }
export interface SubjectResult { subjectId: string; subjectName: string | null; status: string; pagesPlanned: number; pagesWritten: number; pagesValid: number; metrics: Node; pages: PageResult[] }
export interface ConfigDto { configKey: string; plan: string; write: string; reasoningEffort: JsonValue | null; status: string; metrics: JsonValue | null; perSubject: SubjectResult[]; progress: ConfigProgress | null }
export interface EvalDto {
  id: string; setId: string; setName: string | null; status: string; stage: string | null; note: string | null; createdAt: Odt;
  finishedAt: Odt | null; durationSec: number | null; tokensIn: number; tokensOut: number; costUsd: Dec; simulated: boolean;
  error: string | null; sharedDigest: JsonValue | null; configs: ConfigDto[]; progress: unknown; reviewSummary: ReviewProgress | null;
}
export interface SubjectReview { subjectId: string; subjectName: string | null; totalPairs: number; reviewedByMe: number; reviewedByAnyone: number }
export interface ConfigRatings { configKey: string; plan: string | null; write: string | null; ratings: number }
export interface ReviewProgress {
  totalPairs: number; reviewedByMe: number; reviewedByAnyone: number; remainingForMe: number; perSubject: SubjectReview[];
  ratingsPerConfig: ConfigRatings[]; minRatingsForConfidence: number; confident: boolean;
}
export interface Estimate { estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: Dec }
export interface SourceDto { id: string; name: string | null; kind: string | null; author: unknown; academicYear: number | null; academicYearSource: string | null }
export interface LinkDto { raw: string; subjectId: string; slug: string; anchor: string | null; resolved: boolean; title: string | null }
export interface ReviewPage { title: string | null; markdown: string; sources: SourceDto[]; links: LinkDto[] }
export interface ReviewPair { subjectId: string; slug: string; remaining: number; reviewedByMe: number; totalPairs: number; a: ReviewPage; b: ReviewPage }
export interface ConfigRef { configKey: string; plan: string | null; write: string | null }
export interface ReviewResult { revealed: { A: ConfigRef; B: ConfigRef } }
export interface Scores { accuracy: JDouble | null; clarity: JDouble | null; usefulness: JDouble | null }
export interface LeaderboardEntry {
  configKey: string; plan: string; write: string; reasoningEffort: JsonValue | null; evals: number; ratings: number; wins: number;
  losses: number; ties: number; winRate: JDouble | null; avgScores: Scores; metrics: JsonObject; costUsd: Dec; costPerValidPage: Dec | null;
  smallSample: boolean;
}
export interface Leaderboard { setId: string | null; setName: string | null; entries: LeaderboardEntry[] }

class Config {
  constructor(readonly key: string, readonly plan: string, readonly write: string, readonly planEffort: string | null, readonly writeEffort: string | null) {}

  effortNode(): JsonObject | null {
    if (this.planEffort == null && this.writeEffort == null) return null;
    const o: JsonObject = {};
    if (this.planEffort != null) o.plan = this.planEffort;
    if (this.writeEffort != null) o.write = this.writeEffort;
    return o;
  }
}

interface Pair { subjectId: string; slug: string; c1: string; c2: string }

// ---- JsonNode helpers ----------------------------------------------------------------------

/** ObjectNode.with(field): the child object, created when missing. */
function withObj(o: JsonObject, k: string): JsonObject {
  const v = o[k];
  if (isObject(v)) return v;
  const c: JsonObject = {};
  o[k] = c;
  return c;
}

const texts = (arr: Node): string[] => elements(arr).map((x) => asText(x));
const list = (arr: Node): string[] => (arr == null ? [] : elements(arr).map((x) => asText(x)));
const usd = (v: Dec | null): Dec => (v ?? Dec.ZERO).setScale(4, 'HALF_UP');
const round = (v: number): number => Math.round(v * 10000) / 10000.0;
const avg = (sum: number, n: number): JDouble | null => (n === 0 ? null : new JDouble(Math.round((sum / n) * 100) / 100.0));
const fingerprintOf = (fileId: string, fp: string | null): string => (fp != null ? fp : 'file:' + fileId);
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 24);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** String.valueOf(Object) of a YAML value. */
const javaValueOf = (v: unknown): string => (v == null ? 'null' : String(v));

/** Request targets: "<configKey>" (PLAN) or "<configKey>#<slug>"; keys longer than 80 chars are hashed. */
export function target(key: string, slug: string | null): string {
  const k = key.length <= 80 ? key : 'h:' + sha(key);
  const t = slug == null ? k : k + '#' + slug;
  return t.length <= 128 ? t : t.substring(0, 128);
}

const slugOfTarget = (t: string): string => t.substring(t.indexOf('#') + 1);

function pairKey(subjectId: string, slug: string, c1: string, c2: string): string {
  const a = cmp(c1, c2) <= 0 ? c1 : c2;
  const b = cmp(c1, c2) <= 0 ? c2 : c1;
  return `${subjectId}\n${slug}\n${a}\n${b}`;
}

/** pending | planning | writing | validating | done | failed | cancelled */
export function subjectStatus(run: KbRun, subj: Node): string {
  if (asText(path(subj, 'status'), '') === 'CANCELLED') return 'cancelled';
  if (hasNonNull(subj, 'error')) return 'failed';
  if (has(subj, 'metrics')) return 'done';
  switch (run.status) {
    case 'CANCELLED':
      return 'cancelled';
    case 'FAILED':
      return 'failed';
    case 'SUCCEEDED':
    case 'PARTIAL':
      return 'done';
    default:
  }
  switch (run.stage) {
    case 'DETECT':
    case 'DIGEST':
      return 'pending';
    case 'PLAN':
      return 'planning';
    case 'WRITE':
    case 'RETRY':
      return has(subj, 'operations') && isEmpty(path(subj, 'operations')) ? 'done' : 'writing';
    case 'REPORT':
      return 'validating';
    default:
      return 'pending';
  }
}

export class KbEvalService implements KbRunHandler {
  constructor(
    private readonly deps: Deps,
    private readonly settings: KbSettingsService,
    private readonly pipeline: () => PipelineBeans,
    private readonly random: () => number = Math.random,
  ) {}

  private get log() {
    return this.deps.log;
  }

  private tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return kbTx(this.deps.db, fn);
  }

  // ==== benchmark sets =========================================================

  async sets(): Promise<EvalSet[]> {
    await this.ensureDefaultSet();
    return this.tx(async (db) => {
      const out: EvalSet[] = [];
      for (const s of await er.setsByCreatedAt(db)) out.push(await this.setView(db, s));
      return out;
    });
  }

  /** "Básico" (81.07, 61.81, 93.39: large, medium, small), created on first use with the subjects that exist. */
  async ensureDefaultSet(): Promise<void> {
    try {
      if (await this.tx(async (db) => (await er.setByName(db, DEFAULT_SET)) != null)) return;
      const existing = await this.tx(async (db) => [...(await er.subjectNames(db, DEFAULT_SUBJECTS)).keys()].sort(cmp));
      if (!existing.length) return;
      await this.createSet(DEFAULT_SET, existing, null);
    } catch (e) {
      this.log.warn(`KB eval: default set not created: ${(e as Error).message}`);
    }
  }

  async createSet(name: string | null, subjectIds: string[] | null, userId: string | null): Promise<EvalSet> {
    if (name == null || jIsBlank(name)) throw new ValidationError('name', name, 'required');
    if (subjectIds == null || subjectIds.length === 0) throw new ValidationError('subjectIds', subjectIds, 'required');
    const id = await this.tx(async (db) => {
      if ((await er.setByName(db, javaTrim(name))) != null) throw new ResourceAlreadyExistsError('KbEvalSet', name);
      for (const s of subjectIds) {
        if (!(await er.subjectExists(db, s))) throw new ValidationError('subjectIds', s, 'unknown subject');
      }
      const setId = crypto.randomUUID();
      await er.insertSet(db, setId, javaTrim(name), [...new Set(subjectIds)], userId, jvmNow());
      return setId;
    });
    return this.refreeze(id);
  }

  /** Freezes (again) the subjects' current inputs: ids, fingerprints, digests, and the texts into storage. */
  async refreeze(setId: string): Promise<EvalSet> {
    const set = await this.tx(async (db) => {
      const s = await er.setById(db, setId);
      if (s == null) throw new ResourceNotFoundError('KbEvalSet', setId);
      return s;
    });
    const current = await this.tx(() => inputs.current());
    const frozen: JsonObject = {};
    for (const subjectId of texts(set.subjectIds)) {
      const items = current.get(subjectId) ?? [];
      const txt = await this.tx((db) => er.fileTexts(db, items.map((i) => i.fileId)));
      const arr: JsonValue[] = [];
      frozen[subjectId] = arr;
      for (const i of items) {
        const text = txt.get(i.fileId) ?? null;
        if (text == null) continue;
        const key = `kb/evals/sets/${setId}/${i.fileId}.txt`;
        await this.deps.storage.put(key, 'text/plain; charset=utf-8', new TextEncoder().encode(text));
        const fp = fingerprintOf(i.fileId, i.fingerprint);
        const digest = await this.tx(async (db) => (await repo.digestsByFingerprint(db, [fp], PROMPT_VERSION))[0]?.id ?? null);
        arr.push({ fileId: i.fileId, fingerprint: fp, name: i.name, academicYear: i.academicYear, chars: i.chars, textKey: key, digestId: digest });
      }
    }
    return this.tx(async (db) => {
      const s = await er.setById(db, setId);
      if (s == null) throw new ResourceNotFoundError('KbEvalSet', setId);
      const at = nowOdt(this.deps);
      await er.freezeSet(db, setId, frozen, at);
      return this.setView(db, { ...s, frozenInputs: frozen, frozenAt: at });
    });
  }

  private async setView(db: Db, s: er.EvalSetRow): Promise<EvalSet> {
    const ids = texts(s.subjectIds);
    let frozen: FrozenSubject[] | null = null;
    if (s.frozenInputs != null) {
      frozen = [];
      const names = await er.subjectNames(db, ids);
      for (const id of ids) {
        const files = path(s.frozenInputs, id);
        let chars = 0;
        const fps = new Set<string>();
        for (const f of elements(files)) {
          chars += asLong(path(f, 'chars'));
          fps.add(asText(path(f, 'fingerprint')));
        }
        const known = new Set<string>();
        if (fps.size) for (const d of await repo.digestsByFingerprint(db, [...fps], PROMPT_VERSION)) known.add(d.fingerprint);
        frozen.push({ subjectId: id, subjectName: names.get(id) ?? null, files: size(files), chars, digestsMissing: fps.size - known.size });
      }
    }
    return { id: s.id, name: s.name, subjectIds: ids, createdBy: s.createdBy, createdAt: s.createdAt, frozenAt: s.frozenAt, frozen };
  }

  // ==== creating and reading evals ===========================================

  /** models: [{plan, write, reasoningEffort?: {plan?, write?} | "low"|"medium"|"high"}]; key "<plan>[@effort]|<write>[@effort]". */
  async configs(modelsBody: Node): Promise<Config[]> {
    if (modelsBody == null || !isArray(modelsBody) || isEmpty(modelsBody)) {
      throw new ValidationError('models', modelsBody === undefined ? '' : nodeToString(modelsBody), 'at least one {plan, write}');
    }
    const out = new Map<string, Config>();
    for (const m of elements(modelsBody)) {
      const plan = isTextual(m) ? m : asText(path(m, 'plan'), '')!;
      const write = isTextual(m) ? m : asText(path(m, 'write'), plan)!;
      const re = path(m, 'reasoningEffort');
      if (re !== undefined && !isNull(re) && !isObject(re) && !isTextual(re)) {
        throw new ValidationError('reasoningEffort', nodeToString(re), 'must be an object {plan, write} or a string for both stages');
      }
      const pe = this.effort(isTextual(re) ? re : path(re, 'plan'));
      const we = this.effort(isTextual(re) ? re : path(re, 'write'));
      for (const id of [plan, write]) {
        const model = await this.tx((db) => repo.modelById(db, id));
        if (model == null) throw new ValidationError('models', id, 'not in the model catalog');
        if (!model.enabled) throw new ValidationError('models', id, 'is disabled in the catalog');
        if (isCustom(id) && !model.selectableIn('SYNC')) throw new ValidationError('models', id, 'has no successful sync probe yet');
      }
      const key = configKey(plan, pe, write, we);
      if (!out.has(key)) out.set(key, new Config(key, plan, write, pe, we));
    }
    return [...out.values()];
  }

  private effort(n: Node): string | null {
    if (n == null) return null;
    const v = lowerRoot(asText(n));
    if (!EFFORTS.includes(v)) throw new ValidationError('reasoningEffort', v, 'must be low, medium or high');
    return v;
  }

  private configsOf(e: er.EvalRow): Config[] {
    return elements(e.configs).map((c) => new Config(asText(path(c, 'configKey')), asText(path(c, 'plan')), asText(path(c, 'write')),
      asText(path(path(c, 'reasoningEffort'), 'plan'), null), asText(path(path(c, 'reasoningEffort'), 'write'), null)));
  }

  async create(setId: string, modelsBody: Node, note: string | null, userId: string | null): Promise<EvalDto> {
    const configs = await this.configs(modelsBody);
    // The DO key is needed only when some stage model of some config is a DO model.
    const stageModels: string[] = [];
    for (const c of configs) stageModels.push(c.plan, c.write);
    if (!this.pipeline().router.availableFor(stageModels)) {
      throw new KbPipelineError('LLM_UNCONFIGURED', 'Inference is not configured (KB_LLM_API_KEY)');
    }
    const set = await this.tx(async (db) => {
      const s = await er.setById(db, setId);
      if (s == null) throw new ResourceNotFoundError('KbEvalSet', setId);
      return s;
    });
    if (set.frozenInputs == null) await this.refreeze(setId);
    // saveAndFlush on kb_run_one_active_idx (a concurrent create): DataIntegrityViolationException, 409.
    const runId = await this.tx(async (db) => {
      if ((await runRepo.findByStatusInAndTrigger(ACTIVE, 'EVAL')).length > 0) {
        throw new KbPipelineError('EVAL_ACTIVE', 'An eval is already running');
      }
      const summary = configs.map((c) => c.key).join(',');
      // A concurrent eval loses on the one-active-eval index: DuplicateKeyError -> the app's 409 DataIntegrityViolation.
      const run: KbRun = await runRepo.save(new KbRun('EVAL', false, PROMPT_VERSION, summary.length > 128 ? summary.substring(0, 125) + '...' : summary,
        nowOdt(this.deps), {}));
      const arr: JsonValue[] = configs.map((c) => {
        const o: JsonObject = { configKey: c.key, plan: c.plan, write: c.write };
        const e = c.effortNode();
        if (e != null) o.reasoningEffort = e;
        return o;
      });
      await er.insertEval(db, { id: run.id, setId, configs: arr, note, results: { configs: {} }, createdBy: userId, createdAt: jvmNow() });
      return run.id;
    });
    this.log.info(`KB eval ${runId} started on set ${set.name} (${configs.length} configs)`);
    this.pipeline().engine.triggered(runId);
    return this.get(runId);
  }

  async cancel(id: string): Promise<EvalDto> {
    await this.tx((db) => this.evalOr404(db, id));
    await this.pipeline().engine.cancel(id);
    // Cascade: configurations and subjects not finished become CANCELLED.
    await this.tx(async (db) => {
      const e = (await er.evalById(db, id))!;
      const results = deepCopy(e.results) as JsonObject;
      for (const [, cfgV] of fields(withObj(results, 'configs'))) {
        const cfg = cfgV as JsonObject;
        if (!['SUCCEEDED', 'FAILED'].includes(asText(path(cfg, 'status')))) cfg.status = 'CANCELLED';
        for (const [, sv] of fields(withObj(cfg, 'subjects'))) {
          const subj = sv as JsonObject;
          if (!has(subj, 'metrics')) subj.status = 'CANCELLED';
        }
      }
      await er.updateResults(db, id, results);
      await er.finishEval(db, id, nowOdt(this.deps));
    });
    return this.get(id);
  }

  /** POST /pipeline/compare: an eval over an ad-hoc set with one subject. */
  async compare(subjectId: string | null, modelsBody: Node, userId: string | null): Promise<EvalDto> {
    await this.configs(modelsBody); // validate first
    const name = `compare ${subjectId} ${nowOdt(this.deps).toString()}`;
    const set = await this.createSet(name, [subjectId as string], userId);
    return this.create(set.id, modelsBody, 'compare', userId);
  }

  list(setId: string | null, limit: number): Promise<EvalDto[]> {
    return this.tx(async (db) => {
      const n = Math.max(1, Math.min(limit, 100));
      const rows = setId == null ? await er.evalsNewestFirst(db, n) : (await er.evalsOfSetOldestFirst(db, setId)).reverse();
      const out: EvalDto[] = [];
      for (const e of rows.slice(0, n)) out.push(await this.view(db, e, false, null));
      return out;
    });
  }

  get(id: string, viewer: string | null = null): Promise<EvalDto> {
    return this.tx(async (db) => this.view(db, await this.evalOr404(db, id), true, viewer));
  }

  private async evalOr404(db: Db, id: string): Promise<er.EvalRow> {
    const e = await er.evalById(db, id);
    if (e == null) throw new ResourceNotFoundError('KbEval', id);
    return e;
  }

  private async view(db: Db, e: er.EvalRow, full: boolean, viewer: string | null): Promise<EvalDto> {
    const run = (await runRepo.findById(e.id))!;
    const set = await er.setById(db, e.setId);
    const results = e.results;
    const subjectNames = set == null ? new Map<string, string>() : await er.subjectNames(db, texts(set.subjectIds));
    const progress = this.pipeline().progress;
    const rows: ProgressRow[] = full ? await progress.rows(e.id) : [];
    const runState: ProgressRun | null = full ? await progress.state(run) : null;
    let subjectsWithInputs = 0;
    if (set != null && set.frozenInputs != null) {
      for (const sid of texts(set.subjectIds)) if (!isEmpty(path(set.frozenInputs, sid))) subjectsWithInputs++;
    }
    const configs: ConfigDto[] = [];
    for (const c of this.configsOf(e)) {
      const r = path(path(results, 'configs'), c.key);
      const perSubject: SubjectResult[] = [];
      let cfgProgress: ConfigProgress | null = null;
      if (full) {
        for (const [sid, sv] of fields(path(r, 'subjects'))) {
          const pageList: PageResult[] = [];
          let written = 0;
          let valid = 0;
          for (const [slug, v] of fields(path(sv, 'pages'))) {
            pageList.push({ slug, title: asText(path(v, 'title'), null), valid: asBoolean(path(v, 'valid'), false),
              firstPassValid: asBoolean(path(v, 'firstPassValid'), false), errors: list(path(v, 'errors')) });
            const isWritten = hasNonNull(v, 'key') || hasNonNull(v, 'first') || hasNonNull(v, 'final');
            if (isWritten) written++;
            const isValid = has(v, 'valid') ? asBoolean(path(v, 'valid'), false)
              : isWritten && (has(v, 'finalErrors') ? isEmpty(path(v, 'finalErrors')) : isEmpty(path(v, 'firstErrors')));
            if (isValid) valid++;
          }
          // While WRITE runs, pages are only in the request rows.
          const cfgPrefix = target(c.key, null) + '#';
          const answered = rows.filter((x) => x.stage === 'WRITE' && x.status === 'DONE' && x.subjectId === sid && x.target.startsWith(cfgPrefix)).length;
          perSubject.push({ subjectId: sid, subjectName: subjectNames.get(sid) ?? null, status: subjectStatus(run, sv), pagesPlanned: size(path(sv, 'operations')),
            pagesWritten: Math.max(written, answered), pagesValid: valid, metrics: path(sv, 'metrics') ?? null, pages: pageList });
        }
        const prefix = target(c.key, null);
        const mine = rows.filter((x) => x.stage !== 'DIGEST' && (x.target === prefix || x.target.startsWith(prefix + '#')));
        const o = subset(mine, runState!, subjectsWithInputs);
        cfgProgress = { done: o.done, total: o.total, percent: new JDouble(o.percent), stage: run.stage };
      }
      let status = asText(path(r, 'status'), run.isActive() ? 'RUNNING' : run.status)!;
      if (!run.isActive() && status === 'RUNNING') status = run.status; // ended mid-way
      configs.push({ configKey: c.key, plan: c.plan, write: c.write, reasoningEffort: c.effortNode(), status,
        metrics: has(r, 'metrics') ? path(r, 'metrics')! : null, perSubject, progress: cfgProgress });
    }
    const duration = e.finishedAt == null ? null : e.createdAt.secondsUntil(e.finishedAt);
    const runProgress = full ? await progress.progress(e.id) : null;
    const review = full && completed(run.status) ? await this.reviewProgressOf(db, e, viewer) : null;
    return {
      id: e.id, setId: e.setId, setName: set == null ? null : set.name, status: run.status, stage: run.stage, note: e.note,
      createdAt: e.createdAt, finishedAt: e.finishedAt, durationSec: duration, tokensIn: run.tokensIn, tokensOut: run.tokensOut,
      costUsd: usd(run.costEstimate), simulated: run.simulated, error: run.error,
      sharedDigest: has(results, 'sharedDigest') ? path(results, 'sharedDigest')! : null, configs, progress: runProgress, reviewSummary: review,
    };
  }

  async progress(id: string): Promise<unknown> {
    await this.tx((db) => this.evalOr404(db, id));
    return this.pipeline().progress.progress(id);
  }

  reviewProgress(evalId: string, viewer: string | null): Promise<ReviewProgress> {
    return this.tx(async (db) => this.reviewProgressOf(db, await this.evalOr404(db, evalId), viewer));
  }

  private async reviewProgressOf(db: Db, e: er.EvalRow, viewer: string | null): Promise<ReviewProgress> {
    const pairs = this.pairs(e);
    const rated = (await er.ratingsOfEval(db, e.id)).filter((r) => r.ratedAt != null);
    const byAnyone = new Set<string>();
    const byMe = new Set<string>();
    const perConfig = new Map<string, number>();
    for (const c of this.configsOf(e)) perConfig.set(c.key, 0);
    for (const r of rated) {
      const k = pairKey(r.subjectId, r.slug, r.configA, r.configB);
      byAnyone.add(k);
      if (r.reviewerId === viewer) byMe.add(k);
      perConfig.set(r.configA, (perConfig.get(r.configA) ?? 0) + 1);
      perConfig.set(r.configB, (perConfig.get(r.configB) ?? 0) + 1);
    }
    const perSubject = new Map<string, [number, number, number]>();
    for (const p of pairs) {
      const k = pairKey(p.subjectId, p.slug, p.c1, p.c2);
      let a = perSubject.get(p.subjectId);
      if (!a) perSubject.set(p.subjectId, (a = [0, 0, 0]));
      a[0]++;
      if (byMe.has(k)) a[1]++;
      if (byAnyone.has(k)) a[2]++;
    }
    const subjectIds = [...perSubject.keys()].sort(cmp);
    const names = await er.subjectNames(db, subjectIds);
    const subjects = subjectIds.map((id) => {
      const a = perSubject.get(id)!;
      return { subjectId: id, subjectName: names.get(id) ?? null, totalPairs: a[0], reviewedByMe: a[1], reviewedByAnyone: a[2] };
    });
    const byKey = new Map(this.configsOf(e).map((c) => [c.key, c]));
    const cfgs = [...perConfig.entries()].map(([k, n]) => {
      const c = byKey.get(k);
      return { configKey: k, plan: c?.plan ?? null, write: c?.write ?? null, ratings: n };
    });
    const mine = pairs.filter((p) => byMe.has(pairKey(p.subjectId, p.slug, p.c1, p.c2))).length;
    const anyone = pairs.filter((p) => byAnyone.has(pairKey(p.subjectId, p.slug, p.c1, p.c2))).length;
    const confident = cfgs.length > 0 && cfgs.every((c) => c.ratings >= SMALL_SAMPLE);
    return { totalPairs: pairs.length, reviewedByMe: mine, reviewedByAnyone: anyone, remainingForMe: pairs.length - mine, perSubject: subjects,
      ratingsPerConfig: cfgs, minRatingsForConfidence: SMALL_SAMPLE, confident };
  }

  /** Rough input/output tokens and cost of an eval (missing digests, PLAN and WRITE per config x subject, one retry for 15% of the pages). */
  async estimate(setId: string, modelsBody: Node): Promise<Estimate> {
    const configs = await this.configs(modelsBody);
    return this.tx(async (db) => {
      const set = await er.setById(db, setId);
      if (set == null) throw new ResourceNotFoundError('KbEvalSet', setId);
      const s = await this.settings.effective();
      const frozen = set.frozenInputs != null ? set.frozenInputs : await this.frozenFromCurrent(set);
      let input = 0;
      let output = 0;
      let cost = Dec.ZERO;
      const fps = new Set<string>();
      for (const [, files] of fields(frozen)) for (const x of elements(files)) fps.add(asText(path(x, 'fingerprint')));
      const known = new Set<string>();
      if (fps.size) for (const d of await repo.digestsByFingerprint(db, [...fps], PROMPT_VERSION)) known.add(d.fingerprint);
      const catalog = new Map<string, KbModel>((await repo.allModels(db)).map((m) => [m.id, m]));
      const price = (model: string, i: number, o: number): Dec => priceOf(catalog.get(model) ?? null, modeFor(catalog, model, s.executionMode), i, 0, o);
      const seen = new Set<string>();
      for (const [, files] of fields(frozen)) {
        const fileCount = size(files);
        let chars = 0;
        for (const f of elements(files)) {
          chars += asLong(path(f, 'chars'));
          const fp = asText(path(f, 'fingerprint'));
          if (known.has(fp) || seen.has(fp)) continue;
          seen.add(fp);
          const di = Math.trunc(asLong(path(f, 'chars')) / 3.5) + 1500;
          const dout = 600;
          input += di;
          output += dout;
          cost = cost.add(price(s.modelDigest, di, dout));
        }
        const pagesGuess = fileCount + 1;
        for (const c of configs) {
          const pi = 3000 + 800 * fileCount;
          const po = 1500;
          const wi = (3000 + 100 * pagesGuess + Math.min(12_000, Math.trunc(chars / 3.5 / pagesGuess)) + 2400) * pagesGuess;
          const wo = 2500 * pagesGuess;
          const retries = Math.ceil(pagesGuess * 0.15);
          const ri = (3000 + 4000) * retries;
          const ro = 2500 * retries;
          input += pi + wi + ri;
          output += po + wo + ro;
          cost = cost.add(price(c.plan, pi, po)).add(price(c.write, wi + ri, wo + ro));
        }
      }
      return { estimatedInputTokens: input, estimatedOutputTokens: output, estimatedCostUsd: usd(cost) };
    });
  }

  private async frozenFromCurrent(set: er.EvalSetRow): Promise<JsonObject> {
    const current = await inputs.current();
    const o: JsonObject = {};
    for (const sid of texts(set.subjectIds)) {
      o[sid] = (current.get(sid) ?? []).map((i) => ({ fingerprint: fingerprintOf(i.fileId, i.fingerprint), chars: i.chars }));
    }
    return o;
  }

  // ==== KbRunHandler ===============================================================

  handles(run: KbRun): boolean {
    return run.isEval();
  }

  usageStage(_stage: string): string {
    return 'EVAL';
  }

  costLimited(): boolean {
    return false;
  }

  async detect(run: KbRun): Promise<void> {
    await this.tx(async (db) => {
      const e = (await er.evalById(db, run.id))!;
      const set = (await er.setById(db, e.setId))!;
      const missing = (await this.missingDigestFiles(db, set.frozenInputs)).length > 0;
      const results = deepCopy(e.results) as JsonObject;
      const cfgs = withObj(results, 'configs');
      for (const c of this.configsOf(e)) {
        const subj: JsonObject = {};
        cfgs[c.key] = { status: 'RUNNING', subjects: subj };
        for (const s of texts(set.subjectIds)) subj[s] = { pages: {} };
      }
      await er.updateResults(db, run.id, results);
      run.stage = missing ? 'DIGEST' : 'PLAN';
    });
  }

  async build(run: KbRun, stage: string, seq: Seq): Promise<number> {
    return this.tx(async (db) => {
      const e = (await er.evalById(db, run.id))!;
      const set = (await er.setById(db, e.setId))!;
      const s = await this.settings.effective();
      const frozen = set.frozenInputs;
      const { engine, payloads } = this.pipeline();
      const out: KbRunRequest[] = [];
      switch (stage) {
        case 'DIGEST': {
          for (const f of await this.missingDigestFiles(db, frozen)) {
            const text = await this.text(asText(path(f, 'textKey')));
            const parts = chunkText(text);
            for (let i = 0; i < parts.length; i++) {
              const t = `Archivo: ${asText(path(f, 'name'))} (parte ${i + 1}/${parts.length})\n\n${parts[i]}`;
              out.push(engine.request(run, asText(path(f, 'subjectId')), 'DIGEST', asText(path(f, 'fileId')), i, s.modelDigest,
                await payloads.tunedFor(s.modelDigest, 'DIGEST', s, null, t), seq));
            }
          }
          break;
        }
        case 'PLAN': {
          for (const c of this.configsOf(e)) {
            for (const subjectId of texts(set.subjectIds)) {
              const files = path(frozen, subjectId);
              if (isEmpty(files)) continue;
              const related: JsonValue[] = [];
              const stable: JsonObject = { subject: { id: subjectId, name: await this.subjectName(db, subjectId) }, hasIndex: false, pages: [], related };
              await this.relatedInto(db, related, subjectId);
              const added: JsonValue[] = [];
              const body: JsonObject = { addedOrChanged: added };
              const byFp = await this.digestsByFingerprint(db, files);
              for (const f of elements(files)) {
                const d = byFp.get(asText(path(f, 'fingerprint')));
                added.push({ fileId: asText(path(f, 'fileId')), name: asText(path(f, 'name')), academicYear: path(f, 'academicYear') ?? null, digest: d == null ? null : d.digest });
              }
              body.removed = [];
              const params = await payloads.tuned(c.plan, 'PLAN', s.maxTokens('plan'), c.planEffort, payloads.toJson(stable), payloads.toJson(body));
              out.push(engine.request(run, subjectId, 'PLAN', target(c.key, null), 0, c.plan, params, seq));
            }
          }
          break;
        }
        case 'WRITE': {
          const results = e.results;
          for (const c of this.configsOf(e)) {
            for (const subjectId of texts(set.subjectIds)) {
              const r = path(path(path(path(results, 'configs'), c.key), 'subjects'), subjectId);
              const ops = path(r, 'operations');
              if (isEmpty(ops)) continue;
              const files = path(frozen, subjectId);
              const byId = new Map<string, JsonValue>();
              for (const f of elements(files)) byId.set(asText(path(f, 'fileId')), f);
              const byFp = await this.digestsByFingerprint(db, files);
              const index: JsonValue[] = elements(ops).map((op) => ({ slug: asText(path(op, 'slug')), title: asText(path(op, 'title')), aliases: [] }));
              const stable: JsonObject = { subject: { id: subjectId, name: await this.subjectName(db, subjectId) }, pages: index };
              for (const op of elements(ops)) {
                const changed: JsonValue[] = [];
                const body: JsonObject = {
                  slug: asText(path(op, 'slug')), type: asText(path(op, 'type')), title: asText(path(op, 'title')),
                  reason: asText(path(op, 'reason'), '')!, mustCover: mustCover.normalize(path(op, 'mustCover')), changedSources: changed, keptSources: [],
                };
                const sources: SourceText[] = [];
                const keywords = new Set<string>([asText(path(op, 'title'))]);
                for (const src of elements(path(op, 'sources'))) {
                  const f = byId.get(asText(src));
                  if (f == null) continue;
                  const d = byFp.get(asText(path(f, 'fingerprint')));
                  changed.push({ fileId: asText(src), name: asText(path(f, 'name')), academicYear: path(f, 'academicYear') ?? null, digest: d == null ? null : d.digest });
                  if (d != null) for (const t of elements(path(d.digest, 'topics'))) keywords.add(asText(path(t, 'name')));
                  sources.push({ fileId: asText(src), name: asText(path(f, 'name')), text: await this.text(asText(path(f, 'textKey'))) });
                }
                body.excerpts = excerptsOf(sources, keywords).map((x) => ({ fileId: x.fileId, name: x.name, text: x.text }));
                body.removedSources = [];
                body.currentPage = null;
                const params = await payloads.tuned(c.write, 'WRITE', s.maxTokens('write'), c.writeEffort, payloads.toJson(stable), payloads.toJson(body));
                out.push(engine.request(run, subjectId, 'WRITE', target(c.key, asText(path(op, 'slug'))), 0, c.write, params, seq));
              }
            }
          }
          break;
        }
        case 'RETRY': {
          const results = e.results;
          for (const c of this.configsOf(e)) {
            for (const subjectId of texts(set.subjectIds)) {
              const r = path(path(path(path(results, 'configs'), c.key), 'subjects'), subjectId);
              const allowed: JsonValue[] = elements(path(frozen, subjectId)).map((f) => ({ fileId: asText(path(f, 'fileId')), name: asText(path(f, 'name')) }));
              const index: JsonValue[] = elements(path(r, 'operations')).map((op) => ({ slug: asText(path(op, 'slug')), title: asText(path(op, 'title')) }));
              const stable: JsonObject = { subject: { id: subjectId, name: await this.subjectName(db, subjectId) }, pages: index };
              for (const [slug, page] of fields(path(r, 'pages'))) {
                if (!hasNonNull(page, 'first') || isEmpty(path(page, 'firstErrors'))) continue;
                const body: JsonObject = { slug, errors: path(page, 'firstErrors') ?? null };
                for (const op of elements(path(r, 'operations'))) {
                  if (asText(path(op, 'slug')) === slug) body.mustCover = mustCover.normalize(path(op, 'mustCover'));
                }
                body.page = asText(path(page, 'first'));
                body.allowedSources = allowed;
                const params = await payloads.tuned(c.write, 'RETRY', s.maxTokens('retry'), c.writeEffort, payloads.toJson(stable), payloads.toJson(body));
                out.push(engine.request(run, subjectId, 'RETRY', target(c.key, slug), 0, c.write, params, seq));
              }
            }
          }
          break;
        }
        default:
      }
      await requestRepo.saveAll(out);
      return out.length;
    });
  }

  private async stageRows(runId: string, stage: string): Promise<KbRunRequest[]> {
    const ids = await requestRepo.idsByRunAndStage(runId, stage);
    const byId = new Map((await requestRepo.findAllById(ids)).map((r) => [r.customId, r]));
    return ids.map((id) => byId.get(id)!).filter((r) => r != null);
  }

  async after(run: KbRun, stage: string): Promise<void> {
    await this.tx(async (db) => {
      const e = (await er.evalById(db, run.id))!;
      const set = (await er.setById(db, e.setId))!;
      const rows = await this.stageRows(run.id, stage);
      const results = deepCopy(e.results) as JsonObject;
      const today = this.deps.clock.today();
      switch (stage) {
        case 'DIGEST': {
          const byFile = new Map<string, KbRunRequest[]>();
          for (const r of rows) {
            let l = byFile.get(r.target);
            if (!l) byFile.set(r.target, (l = []));
            l.push(r);
          }
          const fpByFile = new Map<string, string>();
          for (const [, files] of fields(set.frozenInputs)) for (const f of elements(files)) fpByFile.set(asText(path(f, 'fileId')), asText(path(f, 'fingerprint')));
          for (const [fileId, list0] of byFile) {
            const list = [...list0].sort((a, b) => a.chunk - b.chunk);
            if (list.some((c) => c.status !== 'DONE')) continue;
            const fp = fpByFile.get(fileId);
            if (fp == null || (await repo.digestsByFingerprint(db, [fp], PROMPT_VERSION)).length > 0) continue;
            // A deleted file's digest is not kept (it would outlive the file).
            if (!(await er.fileExists(db, fileId))) continue;
            await digestRepo.save(new KbFileDigest(fileId, fp, PROMPT_VERSION, list[0]!.model, mergeDigests(list.map((c) => c.result)),
              list.reduce((a, c) => a + c.tokensIn, 0), list.reduce((a, c) => a + c.tokensOut, 0)));
          }
          run.stage = 'PLAN';
          break;
        }
        case 'PLAN': {
          for (const r of rows) {
            const key = await this.configOfTarget(db, r.target);
            const subj = withObj(withObj(withObj(withObj(results, 'configs'), key), 'subjects'), r.subjectId);
            if (r.status !== 'DONE') {
              subj.error = 'PLAN: ' + r.error;
              subj.operations = [];
              continue;
            }
            const proposed = path(r.result, 'operations');
            const check = new KbPlanCheck(proposed);
            const ops = this.validateOps(proposed, path(set.frozenInputs, r.subjectId), check);
            if (check.anyDropped()) {
              this.log.warn(`KB eval ${run.id}: PLAN of ${r.subjectId} (${r.model}, config ${key}) dropped operations: ${check.keptCount()} of ${check.proposed()} kept`);
              subj.droppedPlanOps = check.toJson();
            }
            if (check.emptyAfterFiltering()) {
              subj.error = `PLAN: ${EMPTY_PLAN_ERROR} (dropped ${mapString(check.droppedByReason())})`;
            } else if (check.indexOnly()) {
              subj.error = 'PLAN: ' + INDEX_ONLY_ERROR;
            }
            subj.operations = ops;
          }
          run.stage = 'WRITE';
          break;
        }
        case 'WRITE':
        case 'RETRY': {
          for (const r of rows) {
            const key = await this.configOfTarget(db, r.target);
            const slug = slugOfTarget(r.target);
            const subj = withObj(withObj(withObj(withObj(results, 'configs'), key), 'subjects'), r.subjectId);
            const page = withObj(withObj(subj, 'pages'), slug);
            if (stage === 'RETRY') page.retried = true;
            if (r.status !== 'DONE') {
              if (stage === 'WRITE') {
                page.first = null;
                page.firstErrors = ['no answer from the model: ' + r.error];
              }
              continue;
            }
            const op = elements(path(subj, 'operations')).find((o) => asText(path(o, 'slug')) === slug) ?? null;
            const markdown = isTextual(r.result) ? r.result : asText(path(r.result, 'markdown'), '')!;
            const type = (op == null ? 'CONCEPT' : upperRoot(asText(path(op, 'type'), 'concept')!)) as KbPageType;
            const content = pageFiles.normalize(markdown, r.subjectId, type, op == null ? slug : asText(path(op, 'title'), slug)!, 'do:' + r.model, today);
            page[stage === 'WRITE' ? 'first' : 'final'] = content;
          }
          // Validate per config x subject: first pass after WRITE, final after RETRY.
          for (const c of this.configsOf(e)) {
            const subjects = withObj(withObj(withObj(results, 'configs'), c.key), 'subjects');
            for (const [sid, sv] of fields(subjects)) {
              await this.validateSubject(sid, sv as JsonObject, path(set.frozenInputs, sid), stage === 'WRITE');
            }
          }
          run.stage = stage === 'WRITE' ? 'RETRY' : 'REPORT';
          break;
        }
        default:
      }
      await er.updateResults(db, run.id, results);
    });
  }

  /** A configuration's PLAN whose operations were all dropped is asked once more with a corrective note. */
  async redo(run: KbRun, stage: string): Promise<string[]> {
    if (stage !== 'PLAN') return [];
    return this.tx(async (db) => {
      const e = (await er.evalById(db, run.id))!;
      const frozen = (await er.setById(db, e.setId))!.frozenInputs;
      const { payloads } = this.pipeline();
      const out: string[] = [];
      for (const r of await this.stageRows(run.id, 'PLAN')) {
        if (r.status !== 'DONE') continue;
        const proposed = path(r.result, 'operations');
        const check = new KbPlanCheck(proposed);
        const files = path(frozen, r.subjectId);
        this.validateOps(proposed, files, check);
        if (!check.insufficient()) continue;
        const ids = elements(files).map((f) => asText(path(f, 'fileId')));
        this.log.warn(`KB eval ${run.id}: PLAN of ${r.subjectId} (${r.model}, config ${await this.configOfTarget(db, r.target)}) had no usable operation (${check.proposed()} proposed); asking once more`);
        r.redo(payloads.withNote(r.params, correction(ids, check.indexOnly())));
        out.push(r.customId);
      }
      return out;
    });
  }

  /** REPORT: metrics, pages to storage, done. */
  async complete(runId: string): Promise<void> {
    await this.tx(async (db) => {
      const run = await runRepo.lockById(runId);
      if (run == null || !run.isActive()) return; // cancelled meanwhile
      const e = (await er.evalById(db, runId))!;
      const set = (await er.setById(db, e.setId))!;
      const results = deepCopy(e.results) as JsonObject;
      const allRows: KbRunRequest[] = [];
      for (const st of ['DIGEST', 'PLAN', 'WRITE', 'RETRY']) allRows.push(...(await this.stageRows(runId, st)));
      const costByRequest = new Map<string, Dec>();
      for (const u of await er.usageOfEval(db, runId)) {
        if (u.requestId != null) costByRequest.set(u.requestId, (costByRequest.get(u.requestId) ?? Dec.ZERO).add(u.costUsd));
      }
      const textCache = new Map<string, string>();
      const digestCache = new Map<string, JsonValue | null>();
      const duration = e.createdAt.secondsUntil(nowOdt(this.deps));

      // Digests computed for the set (shared by every configuration).
      const digestRows = allRows.filter((r) => r.stage === 'DIGEST');
      results.sharedDigest = {
        requests: digestRows.length,
        inputTokens: digestRows.reduce((a, r) => a + r.tokensIn, 0),
        outputTokens: digestRows.reduce((a, r) => a + r.tokensOut, 0),
        costUsd: usd(digestRows.reduce((a, r) => a.add(costByRequest.get(r.customId) ?? Dec.ZERO), Dec.ZERO)),
      };

      for (const c of this.configsOf(e)) {
        const cfg = withObj(withObj(results, 'configs'), c.key);
        const allPages: PageInput[] = [];
        let allPlanned = 0;
        const cfgRows: KbRunRequest[] = [];
        for (const r of allRows) if (r.stage !== 'DIGEST' && (await this.configOfTarget(db, r.target)) === c.key) cfgRows.push(r);
        const cfgUsage = usageOf(cfgRows, costByRequest);
        let anyOk = false;
        for (const [subjectId, sv] of fields(withObj(cfg, 'subjects'))) {
          const subj = sv as JsonObject;
          const frozenFiles = path(set.frozenInputs, subjectId);
          const pageInputs: PageInput[] = [];
          const summary: JsonObject = {};
          for (const [slug, page] of fields(path(subj, 'pages'))) {
            const first = hasNonNull(page, 'first') ? asText(path(page, 'first')) : null;
            const fin = hasNonNull(page, 'final') ? asText(path(page, 'final')) : first;
            const firstErrors = list(path(page, 'firstErrors'));
            const finalErrors = has(page, 'finalErrors') ? list(path(page, 'finalErrors')) : firstErrors;
            const sourceText = await this.sourceText(db, fin, frozenFiles, textCache, digestCache);
            pageInputs.push(new PageInput(slug, first, firstErrors, asInt(path(page, 'coverage'), 0), fin, finalErrors, sourceText));
            const fm = fin == null ? null : pageFiles.split(fin).frontmatter;
            const o: JsonObject = {
              title: fm == null ? slug : javaValueOf(fm.title),
              valid: fin != null && finalErrors.length === 0,
              firstPassValid: first != null && firstErrors.length === 0,
              errors: [...finalErrors],
            };
            summary[slug] = o;
            if (fin != null) {
              const key = pageKey(runId, c.key, subjectId, slug);
              await this.deps.storage.put(key, 'text/markdown; charset=utf-8', new TextEncoder().encode(fin));
              o.key = key;
            }
          }
          const planned = size(path(subj, 'operations'));
          allPlanned += planned;
          allPages.push(...pageInputs);
          const subjRows = cfgRows.filter((r) => r.subjectId === subjectId);
          subj.metrics = computeMetrics(pageInputs, planned, usageOf(subjRows, costByRequest), duration);
          subj.pages = summary;
          if (pageInputs.length > 0) anyOk = true;
        }
        cfg.metrics = computeMetrics(allPages, allPlanned, cfgUsage, duration);
        cfg.status = anyOk ? 'SUCCEEDED' : 'FAILED';
      }
      await er.updateResults(db, runId, results);
      const at = nowOdt(this.deps);
      await er.finishEval(db, runId, at);
      run.stage = 'DONE';
      // FAILED when every configuration failed, PARTIAL when some did.
      let total = 0;
      let failed = 0;
      for (const c of this.configsOf(e)) {
        total++;
        if (asText(path(path(path(results, 'configs'), c.key), 'status')) === 'FAILED') failed++;
      }
      const outcome = outcomeOf(total, failed);
      if (outcome !== 'SUCCEEDED' && run.error == null) run.error = `${failed} of ${total} configurations failed`;
      run.finish(outcome, at);
      this.log.info(`KB eval ${runId} done`);
    });
  }

  // ---- eval validation (against the frozen inputs, never the live DB) -------------

  /** Links and validates the subject's pages of one configuration; stores first-pass (or final) errors, and the unlinked mentions before linking. */
  private async validateSubject(subjectId: string, subj: JsonObject, frozenFiles: Node, firstPass: boolean): Promise<void> {
    const pagesNode = withObj(subj, 'pages');
    const contents = new Map<string, string>();
    for (const [slug, v] of fields(pagesNode)) {
      const content = firstPass ? path(v, 'first') : hasNonNull(v, 'final') ? path(v, 'final') : path(v, 'first');
      if (isTextual(content)) contents.set(slug, content);
    }
    const sources = new Map<string, SourceInfo>();
    for (const f of elements(frozenFiles)) {
      const id = parseJavaUuid(asText(path(f, 'fileId'))) ?? asText(path(f, 'fileId'));
      sources.set(id, sourceInfo(id, true, subjectId, await this.text(asText(path(f, 'textKey')))));
    }
    // Targets of the coverage rule: the pages of this configuration.
    const targets: linker.Target[] = [];
    for (const [slug, content] of contents) {
      const fm = pageFiles.split(content).frontmatter;
      const aliases = fm != null && Array.isArray(fm.aliases) ? (fm.aliases as unknown[]).map((a) => javaValueOf(a)) : [];
      targets.push({ slug, title: fm == null ? slug : javaValueOf(fm.title), aliases });
    }
    const linked = new Map<string, string>();
    for (const [slug, content] of contents) {
      const body = pageFiles.split(content).body;
      if (firstPass) withObj(pagesNode, slug).coverage = linker.unlinked(body, slug, targets).length;
      linked.set(slug, pageFiles.replaceBody(content, linker.link(body, slug, targets).body));
    }
    const anchors = new Map<string, Set<string>>();
    const drafts = new Map<string, pageParser.Draft>();
    const errors = new Map<string, string[]>();
    for (const [slug, content] of linked) {
      const parsed = pageParser.parse(slug + '.md', content, subjectId);
      if (!parsed.ok()) {
        errors.set(slug, parsed.errors);
        continue;
      }
      drafts.set(slug, parsed.draft!);
      anchors.set(slug, wikilinks.headingAnchors(parsed.draft!.body));
    }
    for (const d of drafts.values()) {
      const errs = [...validatePage(d, sources)];
      for (const l of d.links.links) {
        if (l.anchor == null || l.subjectId !== subjectId || !anchors.has(l.slug)) continue;
        if (!anchors.get(l.slug)!.has(l.anchor)) errs.push(`link [[${l.raw}]]: no heading '#${l.anchor}' in ${subjectId}/${l.slug}`);
      }
      for (const m of linker.unlinked(d.body, d.slug, targets)) {
        errs.push(`unlinked mention of '${m.text}': link it as [[${m.slug}|${m.text}]]`);
      }
      for (const op of elements(path(subj, 'operations'))) {
        if (asText(path(op, 'slug')) === d.slug) errs.push(...mustCover.missingFormulaErrors(path(op, 'mustCover'), d.body));
      }
      errors.set(d.slug, errs);
    }
    for (const [slug, content] of linked) {
      const page = withObj(pagesNode, slug);
      page[firstPass ? 'firstErrors' : 'finalErrors'] = [...(errors.get(slug) ?? [])];
      page[firstPass ? 'first' : 'final'] = content;
    }
  }

  /** The plan made safe for a full rebuild: creates only, valid slugs, sources limited to the frozen files. */
  validateOps(proposed: Node, frozenFiles: Node, check: KbPlanCheck = new KbPlanCheck(proposed)): JsonValue[] {
    const valid = new Set(elements(frozenFiles).map((f) => asText(path(f, 'fileId'))));
    const out: JsonValue[] = [];
    const seen = new Set<string>();
    check.firstCompile(valid.size); // evals rebuild from scratch
    for (const op of elements(proposed)) {
      const kind = lowerRoot(asText(path(op, 'op'), 'create')!);
      const slug = normalizeIndexSlug(javaTrim(asText(path(op, 'slug'), '')!), asText(path(op, 'type'), '')!);
      if (kind === 'delete') {
        check.dropped(DELETE_IGNORED);
        continue;
      }
      if (!wikilinks.SLUG.test(slug) || slug === 'graph') {
        check.dropped(INVALID_SLUG);
        continue;
      }
      if (seen.has(slug)) {
        check.dropped(DUPLICATE_SLUG);
        continue;
      }
      seen.add(slug);
      let type = slug === 'index' ? 'index' : asText(path(op, 'type'), 'concept')!;
      if (!['topic', 'concept'].includes(type) && slug !== 'index') type = 'concept';
      const sources = elements(path(op, 'sources')).map((x) => asText(x)).filter((x) => valid.has(x));
      if (sources.length === 0) {
        check.droppedForSources(path(op, 'sources'));
        continue;
      }
      check.keptPage(slug);
      out.push({
        op: 'create', slug, type, title: asText(path(op, 'title'), slug.replaceAll('-', ' '))!, sources,
        reason: asText(path(op, 'reason'), '')!, mustCover: mustCover.normalize(path(op, 'mustCover')),
      });
    }
    return out;
  }

  // ==== reading pages and blind review =============================================

  page(evalId: string, configKey: string, subjectId: string, slug: string): Promise<ReviewPage> {
    return this.tx(async (db) => {
      const e = await this.evalOr404(db, evalId);
      const k = this.pageKeyOf(e, configKey, subjectId, slug);
      if (k == null) throw new ResourceNotFoundError('KbEval page', `${configKey}/${subjectId}/${slug}`);
      return this.reviewPage(db, e, configKey, subjectId, k, (await er.setById(db, e.setId))!);
    });
  }

  /** The same page written by two configurations, in random A/B order, model names hidden; null when this reviewer rated every pair. */
  next(evalId: string, reviewerId: string, subjectId: string | null, slug: string | null): Promise<ReviewPair | null> {
    return this.tx(async (db) => {
      const e = await this.evalOr404(db, evalId);
      const set = (await er.setById(db, e.setId))!;
      const all = this.pairs(e);
      const pairs = all.filter((p) => (subjectId == null || p.subjectId === subjectId) && (slug == null || p.slug === slug));
      const mine = (await er.ratingsOfEval(db, evalId)).filter((r) => r.reviewerId === reviewerId);
      const rated = new Set<string>();
      let pending: er.RatingRow | null = null;
      for (const r of mine) {
        const k = pairKey(r.subjectId, r.slug, r.configA, r.configB);
        if (r.ratedAt != null) rated.add(k);
        else if (pending == null && (subjectId == null || r.subjectId === subjectId) && (slug == null || r.slug === slug)) pending = r;
      }
      const open = pairs.filter((p) => !rated.has(pairKey(p.subjectId, p.slug, p.c1, p.c2)));
      if (open.length === 0) return null;
      let assignment: er.RatingRow;
      if (pending != null && !rated.has(pairKey(pending.subjectId, pending.slug, pending.configA, pending.configB))) {
        assignment = pending;
      } else {
        const p = open[Math.floor(this.random() * open.length)]!;
        const swap = this.random() < 0.5;
        assignment = {
          id: crypto.randomUUID(), evalId, subjectId: p.subjectId, slug: p.slug, configA: swap ? p.c2 : p.c1, configB: swap ? p.c1 : p.c2,
          reviewerId, winner: null, accuracyA: null, clarityA: null, usefulnessA: null, accuracyB: null, clarityB: null, usefulnessB: null,
          comment: null, assignedAt: nowOdt(this.deps), ratedAt: null,
        };
        await er.insertRating(db, assignment);
      }
      const a = this.pageKeyOf(e, assignment.configA, assignment.subjectId, assignment.slug);
      const b = this.pageKeyOf(e, assignment.configB, assignment.subjectId, assignment.slug);
      const reviewed = all.length - open.length;
      return {
        subjectId: assignment.subjectId, slug: assignment.slug, remaining: open.length,
        reviewedByMe: subjectId == null && slug == null ? reviewed : (await this.reviewProgressOf(db, e, reviewerId)).reviewedByMe,
        totalPairs: all.length,
        a: await this.reviewPage(db, e, assignment.configA, assignment.subjectId, a, set),
        b: await this.reviewPage(db, e, assignment.configB, assignment.subjectId, b, set),
      };
    });
  }

  /** Rates the pending pair of this page; returns which configurations A and B were. */
  async review(evalId: string, reviewerId: string, body: Node): Promise<ReviewResult> {
    const subjectId = asText(path(body, 'subjectId'), null);
    const slug = asText(path(body, 'slug'), null);
    const winner = asText(path(body, 'winner'), '')!;
    if (!['A', 'B', 'tie'].includes(winner)) throw new ValidationError('winner', winner, 'must be A, B or tie');
    const a = scores(path(body, 'scoresA'), 'scoresA');
    const b = scores(path(body, 'scoresB'), 'scoresB');
    const comment = isTextual(path(body, 'comment')) ? (path(body, 'comment') as string) : null;
    return this.tx(async (db) => {
      const e = await this.evalOr404(db, evalId);
      const pending = (await er.ratingsOfPage(db, evalId, reviewerId, subjectId, slug)).find((r) => r.ratedAt == null);
      if (pending == null) throw new KbPipelineError('NO_PAIRS', 'No pending pair for this page; call review/next first');
      pending.winner = winner === 'A' ? pending.configA : winner === 'B' ? pending.configB : 'tie';
      if (a != null) [pending.accuracyA, pending.clarityA, pending.usefulnessA] = a;
      if (b != null) [pending.accuracyB, pending.clarityB, pending.usefulnessB] = b;
      pending.comment = comment;
      pending.ratedAt = nowOdt(this.deps);
      await er.updateRating(db, pending);
      const byKey = new Map(this.configsOf(e).map((c) => [c.key, c]));
      const ref = (key: string): ConfigRef => {
        const c = byKey.get(key);
        return c == null ? { configKey: key, plan: null, write: null } : { configKey: c.key, plan: c.plan, write: c.write };
      };
      return { revealed: { A: ref(pending.configA), B: ref(pending.configB) } };
    });
  }

  /** Pages (subject, slug) written by at least two configurations, as pairs. */
  private pairs(e: er.EvalRow): Pair[] {
    const byPage = new Map<string, string[]>();
    for (const [ck, cv] of fields(path(e.results, 'configs'))) {
      for (const [sid, sv] of fields(path(cv, 'subjects'))) {
        for (const [slug, pv] of fields(path(sv, 'pages'))) {
          if (!hasNonNull(pv, 'key')) continue;
          const k = sid + '\n' + slug;
          let l = byPage.get(k);
          if (!l) byPage.set(k, (l = []));
          l.push(ck);
        }
      }
    }
    const out: Pair[] = [];
    for (const k of [...byPage.keys()].sort(cmp)) {
      const cs = byPage.get(k)!;
      const [sid, slug] = k.split('\n') as [string, string];
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) out.push({ subjectId: sid, slug, c1: cs[i]!, c2: cs[j]! });
    }
    return out;
  }

  private pageKeyOf(e: er.EvalRow, configKey: string, subjectId: string, slug: string): string | null {
    return asText(path(path(path(path(path(path(path(e.results, 'configs'), configKey), 'subjects'), subjectId), 'pages'), slug), 'key'), null);
  }

  private async reviewPage(db: Db, e: er.EvalRow, configKey: string, subjectId: string, key: string | null, set: er.EvalSetRow): Promise<ReviewPage> {
    const content = key == null ? '' : await this.text(key);
    const parts = pageFiles.split(content);
    const fm = parts.frontmatter;
    // Sources: the reader's shape; files gone since the freeze keep their frozen name.
    const ids: string[] = [];
    if (fm != null && Array.isArray(fm.sources)) {
      for (const s of fm.sources as unknown[]) {
        const id = parseJavaUuid(javaValueOf(s));
        if (id != null) ids.push(id);
      }
    }
    const found = new Map((await kbReader(this.deps).views.staffSources(db, ids)).map((s) => [s.id, s]));
    const frozen = new Map(elements(path(set.frozenInputs, subjectId)).map((f) => [asText(path(f, 'fileId')), f]));
    const sources: SourceDto[] = [];
    for (const id of ids) {
      let s: SourceDto | undefined = found.get(id) as SourceDto | undefined;
      if (s == null) {
        const f = frozen.get(id);
        s = { id, name: f == null ? null : asText(path(f, 'name'), null), kind: null, author: null,
          academicYear: f == null || !canConvertToInt(path(f, 'academicYear')) ? null : asInt(path(f, 'academicYear')), academicYearSource: null };
      }
      sources.push(s);
    }
    // Links: resolved against the pages this configuration wrote for the subject, else against live visible pages.
    const written = path(path(path(path(path(e.results, 'configs'), configKey), 'subjects'), subjectId), 'pages');
    const links: LinkDto[] = [];
    for (const l of wikilinks.parse(parts.body, subjectId).links) {
      let title: string | null = null;
      if (l.subjectId === subjectId && hasNonNull(path(written, l.slug), 'key')) {
        title = asText(path(path(written, l.slug), 'title'), l.slug);
      } else {
        const live = await pageRepo.findBySubjectIdAndSlug(l.subjectId, l.slug);
        if (live != null && (live.status === 'PUBLISHED' || live.status === 'HIDDEN')) title = live.title;
      }
      links.push({ raw: l.raw, subjectId: l.subjectId, slug: l.slug, anchor: l.anchor, resolved: title != null, title });
    }
    return { title: fm == null ? null : javaValueOf(fm.title), markdown: parts.body, sources, links };
  }

  // ==== leaderboard and promote ======================================================

  async leaderboard(setId: string | null): Promise<Leaderboard> {
    if (setId == null) await this.ensureDefaultSet();
    return this.tx(async (db) => {
      let set: er.EvalSetRow | null;
      if (setId != null) {
        set = await er.setById(db, setId);
        if (set == null) throw new ResourceNotFoundError('KbEvalSet', setId);
      } else {
        set = await er.setByName(db, DEFAULT_SET);
      }
      if (set == null) return { setId: null, setName: null, entries: [] };
      const done: er.EvalRow[] = [];
      for (const e of await er.evalsOfSetOldestFirst(db, set.id)) {
        const run = await runRepo.findById(e.id);
        if (run != null && completed(run.status)) done.push(e);
      }
      const configs = new Map<string, Config>();
      const metrics = new Map<string, JsonValue[]>();
      for (const e of done) {
        for (const c of this.configsOf(e)) {
          if (!configs.has(c.key)) configs.set(c.key, c);
          const m = path(path(path(e.results, 'configs'), c.key), 'metrics');
          if (isObject(m)) {
            let l = metrics.get(c.key);
            if (!l) metrics.set(c.key, (l = []));
            l.push(m);
          }
        }
      }
      const all = (await er.ratingsOfEvals(db, done.map((e) => e.id))).filter((r) => r.ratedAt != null);
      const entries: LeaderboardEntry[] = [];
      for (const c of configs.values()) {
        let wins = 0;
        let losses = 0;
        let ties = 0;
        const acc = [0, 0, 0];
        const cnt = [0, 0, 0];
        for (const r of all) {
          const isA = r.configA === c.key;
          const isB = r.configB === c.key;
          if (!isA && !isB) continue;
          if (r.winner === 'tie') ties++;
          else if (r.winner === c.key) wins++;
          else losses++;
          const sc = isA ? [r.accuracyA, r.clarityA, r.usefulnessA] : [r.accuracyB, r.clarityB, r.usefulnessB];
          for (let i = 0; i < 3; i++) {
            if (sc[i] != null) {
              acc[i]! += sc[i]!;
              cnt[i]!++;
            }
          }
        }
        const n = wins + losses + ties;
        const combined = this.combine(metrics.get(c.key) ?? []);
        const cost = decimalValue(combined.costUsd);
        const valid = asInt(combined.validPages);
        entries.push({
          configKey: c.key, plan: c.plan, write: c.write, reasoningEffort: c.effortNode(), evals: (metrics.get(c.key) ?? []).length, ratings: n,
          wins, losses, ties, winRate: n === 0 ? null : new JDouble(Math.round(((wins + ties / 2.0) / n) * 10000) / 10000.0),
          avgScores: { accuracy: avg(acc[0]!, cnt[0]!), clarity: avg(acc[1]!, cnt[1]!), usefulness: avg(acc[2]!, cnt[2]!) },
          metrics: combined, costUsd: usd(cost), costPerValidPage: valid === 0 ? null : cost.divide(Dec.fromInt(valid), 4, 'HALF_UP'),
          smallSample: n < SMALL_SAMPLE,
        });
      }
      const rate = (x: LeaderboardEntry) => (x.winRate == null ? -1 : x.winRate.value);
      const MAX = Dec.fromInt(BigInt('9223372036854775807'));
      entries.sort((x, y) => {
        const r = rate(y) - rate(x);
        if (r !== 0) return r < 0 ? -1 : 1;
        return (x.costPerValidPage ?? MAX).compareTo(y.costPerValidPage ?? MAX);
      });
      return { setId: set.id, setName: set.name, entries };
    });
  }

  /** Totals of several evals of one configuration (rates weighted by size). */
  combine(metrics: JsonValue[]): JsonObject {
    const sums = new Array<number>(12).fill(0);
    let cost = Dec.ZERO;
    let fp = 0;
    let fv = 0;
    let cd = 0;
    let unsup = 0;
    let words = 0;
    let empty = 0;
    const reasons = new Map<string, number>();
    for (const m of metrics) {
      const written = asLong(path(m, 'pagesWritten'));
      const checked = asLong(path(m, 'claimsChecked'));
      sums[0]! += asLong(path(m, 'pagesPlanned'));
      sums[1]! += written;
      sums[2]! += asLong(path(m, 'validPages'));
      sums[3]! += asLong(path(m, 'uncitedSections'));
      sums[4]! += asLong(path(m, 'coverageViolations'));
      sums[5]! += asLong(path(m, 'copyViolations'));
      sums[6]! += asLong(path(m, 'crossLinks'));
      sums[7]! += asLong(path(m, 'anchors'));
      sums[8]! += asLong(path(m, 'inputTokens'));
      sums[9]! += asLong(path(m, 'outputTokens'));
      sums[10]! += checked;
      sums[11]! += asLong(path(m, 'durationSec'));
      cost = cost.add(decimalValue(path(m, 'costUsd')));
      fp += asDouble(path(m, 'firstPassValidRate')) * written;
      fv += asDouble(path(m, 'finalValidRate')) * written;
      cd += asDouble(path(m, 'citationDensity')) * written;
      words += asDouble(path(m, 'avgWords')) * written;
      unsup += asDouble(path(m, 'unsupportedClaimsRate')) * checked;
      empty += asDouble(path(m, 'emptyToolCallRate'));
      for (const [k, v] of fields(path(m, 'rejectReasons'))) reasons.set(k, (reasons.get(k) ?? 0) + asInt(v));
    }
    const written = sums[1]!;
    const d = (v: number) => new JDouble(v);
    const rr: JsonObject = {};
    for (const k of [...reasons.keys()].sort(cmp)) rr[k] = reasons.get(k)!;
    return {
      pagesPlanned: sums[0]!,
      pagesWritten: written,
      validPages: sums[2]!,
      firstPassValidRate: d(written === 0 ? 0 : round(fp / written)),
      finalValidRate: d(written === 0 ? 0 : round(fv / written)),
      rejectReasons: rr,
      citationDensity: d(written === 0 ? 0 : round(cd / written)),
      uncitedSections: sums[3]!,
      coverageViolations: sums[4]!,
      copyViolations: sums[5]!,
      unsupportedClaimsRate: d(sums[10] === 0 ? 0 : round(unsup / sums[10]!)),
      claimsChecked: sums[10]!,
      groundingIsHeuristic: true,
      avgWords: written === 0 ? 0 : Math.round(words / written),
      crossLinks: sums[6]!,
      anchors: sums[7]!,
      inputTokens: sums[8]!,
      outputTokens: sums[9]!,
      costUsd: usd(cost),
      costPerValidPage: sums[2] === 0 ? null : cost.divide(Dec.fromInt(sums[2]!), 4, 'HALF_UP'),
      emptyToolCallRate: d(metrics.length === 0 ? 0 : round(empty / metrics.length)),
      durationSec: metrics.length === 0 ? 0 : Math.trunc(sums[11]! / metrics.length),
    };
  }

  /** Copies a configuration's models (and efforts) into the runtime settings, with the same validation and history as PUT /settings. */
  async promote(evalId: string, key: string | null, userId: string): Promise<KbSettingsResponse> {
    const e = await this.tx((db) => this.evalOr404(db, evalId));
    const c = this.configsOf(e).find((x) => x.key === key);
    if (c == null) throw new ValidationError('configKey', key, 'not a configuration of this eval');
    const body: JsonObject = { modelPlan: c.plan, modelWrite: c.write, modelRetry: c.write };
    if (c.planEffort != null || c.writeEffort != null) {
      const current = (await this.settings.effective()).reasoningEffortNode;
      body.reasoningEffort = { digest: path(current, 'digest') ?? null, plan: c.planEffort, write: c.writeEffort, retry: c.writeEffort };
    }
    body.note = `promoted from eval ${evalId} (${key})`;
    return this.settings.update(userId, body);
  }

  // ==== helpers ==========================================================================

  /** Frozen files whose content has no digest yet (one entry per fingerprint). */
  private async missingDigestFiles(db: Db, frozen: Node): Promise<JsonObject[]> {
    const out: JsonObject[] = [];
    if (frozen == null) return out;
    const fps = new Set<string>();
    for (const [, files] of fields(frozen)) for (const f of elements(files)) fps.add(asText(path(f, 'fingerprint')));
    const known = new Set<string>();
    if (fps.size) for (const d of await repo.digestsByFingerprint(db, [...fps], PROMPT_VERSION)) known.add(d.fingerprint);
    const seen = new Set<string>();
    for (const [sid, files] of fields(frozen)) {
      for (const f of elements(files)) {
        const fp = asText(path(f, 'fingerprint'));
        if (known.has(fp) || seen.has(fp)) continue;
        seen.add(fp);
        const o = deepCopy(f) as JsonObject;
        o.subjectId = sid;
        out.push(o);
      }
    }
    return out;
  }

  private async digestsByFingerprint(db: Db, files: Node): Promise<Map<string, { digest: JsonValue }>> {
    const fps = new Set(elements(files).map((f) => asText(path(f, 'fingerprint'))));
    const out = new Map<string, { digest: JsonValue }>();
    if (!fps.size) return out;
    for (const d of await repo.digestsByFingerprint(db, [...fps], PROMPT_VERSION)) if (!out.has(d.fingerprint)) out.set(d.fingerprint, { digest: d.digest });
    return out;
  }

  /** Cited sources' frozen texts plus their digests (the grounding corpus). */
  private async sourceText(db: Db, content: string | null, frozenFiles: Node, cache: Map<string, string>, digestCache: Map<string, JsonValue | null>): Promise<string> {
    if (content == null) return '';
    const cited = new Set(pageFiles.citedIds(pageFiles.split(content).body));
    let sb = '';
    for (const f of elements(frozenFiles)) {
      if (!cited.has(asText(path(f, 'fileId')))) continue;
      const key = asText(path(f, 'textKey'));
      if (!cache.has(key)) cache.set(key, await this.text(key));
      sb += cache.get(key)! + '\n';
      const fp = asText(path(f, 'fingerprint'));
      if (!digestCache.has(fp)) digestCache.set(fp, (await repo.digestsByFingerprint(db, [fp], PROMPT_VERSION))[0]?.digest ?? null);
      const d = digestCache.get(fp);
      if (d != null) sb += nodeToString(d) + '\n';
    }
    return sb;
  }

  private async relatedInto(db: Db, arr: JsonValue[], subjectId: string): Promise<void> {
    let n = 0;
    for (const rel of await relationRepo.findBySubject(subjectId)) {
      if (n >= 8) break;
      const relPages = await pageRepo.findBySubjectIdAndStatusIn(rel.relatedId, ['PUBLISHED']);
      if (relPages.length === 0) continue;
      n++;
      arr.push({
        subjectId: rel.relatedId, name: await this.subjectName(db, rel.relatedId),
        pages: [...relPages].sort((a, b) => cmp(a.slug, b.slug)).map((p) => ({ slug: p.slug, title: p.title, summary: p.summary })),
      });
    }
  }

  private async configOfTarget(db: Db, t: string): Promise<string> {
    const key = t.includes('#') ? t.substring(0, t.indexOf('#')) : t;
    if (!key.startsWith('h:')) return key;
    for (const e of await er.allEvals(db)) for (const c of this.configsOf(e)) if ('h:' + sha(c.key) === key) return c.key;
    return key;
  }

  private async text(key: string): Promise<string> {
    const bytes = await this.deps.storage.get(key);
    return bytes == null ? '' : new TextDecoder().decode(bytes);
  }

  private async subjectName(db: Db, id: string): Promise<string> {
    return (await er.subjectNames(db, [id])).get(id) ?? id;
  }
}

export function pageKey(evalId: string, key: string, subjectId: string, slug: string): string {
  return `kb/evals/${evalId}/${key.replaceAll('|', '__').replaceAll('@', '_at_')}/${subjectId}/${slug}.md`;
}

function usageOf(rows: KbRunRequest[], costByRequest: Map<string, Dec>): Usage {
  let input = 0;
  let output = 0;
  let cost = Dec.ZERO;
  let empty = 0;
  for (const r of rows) {
    input += r.tokensIn;
    output += r.tokensOut;
    cost = cost.add(costByRequest.get(r.customId) ?? Dec.ZERO);
    const err = r.error;
    if ((err != null && (err.startsWith('EMPTY_TOOL') || err.startsWith('TRUNCATED'))) || (r.execPath != null && r.execPath.endsWith('+retry'))) empty++;
  }
  return { inputTokens: input, outputTokens: output, costUsd: cost, requests: rows.length, emptyToolCalls: empty };
}

function scores(n: Node, field: string): [number | null, number | null, number | null] | null {
  if (n == null) return null;
  const out: [number | null, number | null, number | null] = [null, null, null];
  const names = ['accuracy', 'clarity', 'usefulness'];
  for (let i = 0; i < 3; i++) {
    const v = path(n, names[i]!);
    if (v == null) continue;
    if (!canConvertToInt(v) || asInt(v) < 1 || asInt(v) > 5) throw new ValidationError(`${field}.${names[i]}`, nodeToString(v), 'must be 1-5');
    out[i] = asInt(v);
  }
  return out;
}

/** AbstractMap.toString(): {a=1, b=2}. */
function mapString(m: Map<string, number>): string {
  return '{' + [...m.entries()].map(([k, v]) => `${k}=${v}`).join(', ') + '}';
}
