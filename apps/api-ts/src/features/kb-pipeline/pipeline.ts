// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbPipelineService.java.
//
// The wiki self-update pipeline (docs/SUBJECT-WIKI-PIPELINE.md), as a KbRunHandler on
// top of KbRunEngine:
//
//   DETECT -> DIGEST -> PLAN -> WRITE -> [RETRY] -> PUBLISH
//
// DETECT diffs every subject's inputs against kb_subject_state (nothing dirty:
// zero requests). DIGEST sends each new content version once (by fingerprint).
// PLAN sees the page index, the digests of the changes and the removed files,
// never page bodies or unchanged files. WRITE sees raw excerpts only of the
// added/changed files a page draws on. LINK and VALIDATE run in code; PUBLISH goes
// through the import service, one transaction per subject, and records the inputs
// used. Models come from the runtime settings at each stage's build.

import type { Database, Tx as DbTx } from '../../db/client';
import type { Logger } from '../../infra/logger';
import { ResourceNotFoundError } from '../../http/errors';
import { SpringCron } from '../kb-admin/cron';
import { Dec } from '../kb/logic/decimal';
import type { KbEffectiveSettings } from '../kb/logic/admin/kbSettings';
import { jIsBlank, jTrim, javaValueOf, lowerRoot, upperRoot } from '../kb/logic/javaString';
import {
  asInt, asLong, asText, decimalValue, deepCopy, elements, fields, has, hasNonNull, isEmpty, isObject, isTextual, path,
  size, type JsonObject, type JsonValue,
} from '../kb/logic/jsonNode';
import { link, type Target } from '../kb/logic/kbLinker';
import { missingFormulaErrors, normalize as normalizeMustCover } from '../kb/logic/kbMustCover';
import { headingAnchors, SLUG } from '../kb/logic/kbWikilinks';
import type { KbLlmRouter } from '../kb/logic/llm/kbLlmRouter';
import { ART_ZONE, type Now, type Odt } from '../kb/logic/odt';
import { admit, type Candidate } from '../kb/logic/pipeline/kbAdmission';
import { compiledInputs } from '../kb/logic/pipeline/kbCompiledInputs';
import { mergePartial, tolerableMissing } from '../kb/logic/pipeline/kbDigests';
import { file as pageFileOf, normalize as normalizePage, replaceBody, split as splitPage } from '../kb/logic/pipeline/kbPageFiles';
import { chunks as chunksOf, excerpts as excerptsOf, PROMPT_VERSION, type KbPayloads, type SourceText } from '../kb/logic/pipeline/kbPayloads';
import { correction, EMPTY_PLAN_ERROR, INDEX_ONLY_ERROR, INVALID_OP, INVALID_SLUG, DUPLICATE_SLUG, KbPlanCheck, normalizeIndexSlug, UNKNOWN_PAGE } from '../kb/logic/pipeline/kbPlanCheck';
import { KbPipelineError } from '../kb/logic/pipeline/kbPipelineError';
import { status as outcomeStatus } from '../kb/logic/pipeline/kbRunOutcome';
import { KbRunRequest, type KbPageType } from '../kb/logic/types';
import type { KbForecastPort, KbImporterPort, KbImportPage, KbSettingsPort } from './collaborators';
import { KbFileDigest, KbRun, KbRunSubject, KbSubjectState, type KbPageView } from './db/entities';
import { digests, files, jobs, pages, relations, requests, runs, runSubjects, states, subjects } from './db/repo';
import { inTx, session } from './db/session';
import { odtJson, type KbBaselineResponse, type KbBatchJobResponse, type KbPreviewFile, type KbPreviewResponse, type KbPreviewSubject, type KbProgressResponse, type KbRunBudgetResponse, type KbRunResponse, type KbRunSubjectResponse } from './dto';
import { ACTIVE, javaSimpleName, type KbRunEngine, type KbRunHandler, type Seq } from './engine';
import * as inputs from './inputs';
import type { KbProgressService } from './progress';

export const BUDGET_REASON = 'presupuesto de la corrida';
/** DIGEST reads the raw text of this many files at a time. */
export const DIGEST_PAGE = 20;
const ID_PAGE = 1000;
/** PLAN requests carry the digests of a whole subject: few per page. */
const REDO_PAGE = 50;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function pagesOf<T>(all: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += n) out.push(all.slice(i, i + n));
  return out;
}

export function usd(v: Dec | null): Dec {
  return (v ?? Dec.ZERO).setScale(4, 'HALF_UP');
}

function usdText(v: Dec): string {
  return v.signum() > 0 && v.compareTo(Dec.parse('0.01')) < 0 ? '<0.01' : v.setScale(2, 'HALF_UP').toPlainString();
}

export function skippedNote(n: number): string {
  return n + (n === 1 ? ' archivo sin resumen' : ' archivos sin resumen') + '; se reintentan en la próxima corrida';
}

/** Content without a stored fingerprint is keyed by its file. */
export function fingerprintOf(fileId: string, fingerprint: string | null): string {
  return fingerprint != null ? fingerprint : 'file:' + fileId;
}

function inputFingerprint(input: JsonValue | undefined): string {
  const fp = path(input, 'fingerprint');
  return isTextual(fp) ? fp : 'file:' + asText(path(input, 'fileId'));
}

function hasRejectedDraft(drafts: JsonValue): boolean {
  for (const d of elements(drafts)) {
    if (asText(path(d, 'origin')) === 'write' && !isEmpty(path(d, 'errors'))) return true;
  }
  return false;
}

/** Map.toString() of the dropped-op counts, for logs. */
function mapText(m: Map<string, number>): string {
  return '{' + [...m].map(([k, v]) => `${k}=${v}`).join(', ') + '}';
}

/** KbPageFiles.of(KbPage): the page as a file (generated_at: the stored date, UTC). */
export function pageFile(p: KbPageView): string {
  const l = p.generatedAt.local();
  const day = `${String(l.year).padStart(4, '0')}-${String(l.month).padStart(2, '0')}-${String(l.day).padStart(2, '0')}`;
  return pageFileOf(p.title, p.subjectId, p.wire(), p.summary, p.aliases, p.sources, p.generator, day, p.markdown);
}

export interface PipelineParts {
  db: Database;
  log: Logger;
  /** OffsetDateTime.now(clock) (ART). */
  now: Now;
  engine: KbRunEngine;
  payloads: KbPayloads;
  router: KbLlmRouter;
  progress: KbProgressService;
  settings: () => KbSettingsPort;
  forecast: () => KbForecastPort;
  importer: () => KbImporterPort | null;
  /** Weekly price refresh before a scheduled run (KbModelCatalogService.sync), when registered. */
  refreshPrices: () => Promise<void> | null;
}

export class KbPipelineService implements KbRunHandler {
  private lastScheduleCheck: Odt | null = null;

  constructor(private readonly p: PipelineParts) {}

  private get db(): Database {
    return this.p.db;
  }

  private get log(): Logger {
    return this.p.log;
  }

  private now(): Odt {
    return this.p.now();
  }

  private settings(): KbSettingsPort {
    return this.p.settings();
  }

  // ==== API =========================================================================

  /** Creates a run (409 KB_RUN_ACTIVE when one is active; 503 KB_LLM_UNCONFIGURED without inference unless dry) and starts it. */
  async trigger(trigger: string, dryRun: boolean): Promise<KbRunResponse> {
    const s = await this.settings().effective();
    // The DO key is needed only when some stage model is a DO model.
    const stageModels: (string | null)[] = [s.modelDigest, s.modelPlan, s.modelWrite, s.modelRetry];
    if (s.subjectOverrides != null) {
      for (const o of elements(s.subjectOverrides)) {
        stageModels.push(asText(path(o, 'modelWrite'), null));
        stageModels.push(asText(path(o, 'modelPlan'), null));
      }
    }
    if (!dryRun && !this.p.router.availableFor(stageModels)) {
      throw new KbPipelineError('LLM_UNCONFIGURED', 'Inference is not configured (KB_LLM_API_KEY); only dry runs are possible');
    }
    const run = await inTx(this.db, async () => {
      if ((await runs.findByStatusInAndTriggerNot(ACTIVE, 'EVAL')).length > 0) {
        throw new KbPipelineError('RUN_ACTIVE', 'A pipeline run is already active');
      }
      return runs.save(new KbRun(trigger, dryRun, PROMPT_VERSION, `${s.modelDigest}|${s.modelPlan}|${s.modelWrite}`, this.now(), {}, {}));
    });
    this.log.info(`KB pipeline: run ${run.id} started (${trigger}, dryRun=${dryRun})`);
    this.p.engine.triggered(run.id);
    return inTx(this.db, () => this.summary(run, false));
  }

  runs(limit: number): Promise<KbRunResponse[]> {
    return inTx(this.db, async () => {
      const out: KbRunResponse[] = [];
      for (const r of await runs.findByTriggerNotOrderByStartedAtDesc('EVAL', Math.max(1, Math.min(limit, 100)))) {
        out.push(await this.summary(r, false));
      }
      return out;
    });
  }

  run(id: string): Promise<KbRunResponse> {
    return inTx(this.db, async () => {
      const r = await runs.findById(id);
      if (r == null) throw new ResourceNotFoundError('KbRun', id);
      return this.summary(r, true);
    });
  }

  async progress(id: string): Promise<KbProgressResponse> {
    await inTx(this.db, async () => {
      const r = await runs.findById(id);
      if (r == null || r.isEval()) throw new ResourceNotFoundError('KbRun', id);
    });
    return this.p.progress.progress(id);
  }

  async cancel(id: string): Promise<KbRunResponse> {
    await this.p.engine.cancel(id);
    return inTx(this.db, async () => {
      const r = (await runs.findById(id))!;
      await this.refreshSummary(r);
      return this.summary(r, true);
    });
  }

  async approveCost(id: string): Promise<KbRunResponse> {
    await this.p.engine.approveCost(id);
    this.p.engine.triggered(id);
    return this.run(id);
  }

  /**
   * Weekly schedule (runtime settings: enabled + cron, Buenos Aires time), checked
   * every minute: fires when the cron had a fire time since the previous check.
   * After a restart the previous check is the last scheduled run's start (at most
   * a day back).
   */
  async schedulerTick(): Promise<void> {
    const s = await this.settings().effective();
    const now = this.now();
    const last = this.lastScheduleCheck ?? (await this.resumePoint(now));
    this.lastScheduleCheck = now;
    if (!s.enabled || !SpringCron.isValidExpression(s.cron)) return;
    // CronExpression.parse(cron).next(last), fired when it is not after now.
    if (SpringCron.parse(s.cron).countFires(last.epochSecond, now.epochSecond, 1, ART_ZONE, 1) === 0) return;
    if (s.autoRefreshPrices) {
      try {
        await this.p.refreshPrices();
      } catch (e) {
        this.log.warn(`KB pipeline: price refresh before the scheduled run failed: ${(e as Error).message}`);
      }
    }
    try {
      await this.trigger('SCHEDULED', false);
    } catch (e) {
      if (!(e instanceof KbPipelineError)) throw e;
      this.log.warn(`KB pipeline: scheduled run skipped: ${e.message}`);
    }
  }

  private async resumePoint(now: Odt): Promise<Odt> {
    const floor = now.plusHours(-24);
    const r = await inTx(this.db, () => runs.findFirstByTriggerOrderByStartedAtDesc('SCHEDULED'));
    if (r == null) return now;
    return r.startedAt.isBefore(floor) ? floor : r.startedAt;
  }

  /** Records the current inputs of every subject with kb pages as compiled (once, after the hand-written import). */
  baseline(): Promise<KbBaselineResponse> {
    return inTx(this.db, async () => {
      const current = await inputs.current();
      const out: string[] = [];
      for (const subject of await inputs.subjectsWithPages()) {
        const inp = inputs.toJson(current.get(subject) ?? []);
        const state = (await states.findById(subject)) ?? new KbSubjectState(subject);
        state.compiled(inputs.hash(inp), inp, this.now(), null);
        await states.save(state);
        out.push(subject);
      }
      this.log.info(`KB pipeline: baseline recorded for ${out.length} subjects`);
      return { subjects: out };
    });
  }

  /** What the next run would do; never calls the LLM. */
  preview(): Promise<KbPreviewResponse> {
    return inTx(this.db, async () => {
      const s = await this.settings().effective();
      const diffs = await inputs.diffs((id) => s.paused(id));
      const dirty = diffs.filter((d) => d.dirty()).map((d, i) => ({ d, i }))
        .sort((a, b) => b.d.priority() - a.d.priority() || a.i - b.i).map((x) => x.d);
      const fps = new Set<string>();
      for (const d of dirty) {
        for (const i of d.added) fps.add(fingerprintOf(i.fileId, i.fingerprint));
        for (const i of d.changed) fps.add(fingerprintOf(i.fileId, i.fingerprint));
      }
      const known = new Set<string>();
      if (fps.size > 0) {
        for (const dg of await digests.findByContentFingerprintInAndPromptVersion(fps, PROMPT_VERSION)) known.add(dg.contentFingerprint);
      }
      const names = await subjects.names(dirty.map((d) => d.subjectId));
      const pageCounts = new Map<string, number>();
      for (const [subject] of await pages.findSubjectSources(['PUBLISHED', 'HIDDEN'])) {
        pageCounts.set(subject, (pageCounts.get(subject) ?? 0) + 1);
      }
      const planned = new Set<string>();
      let total = 0;
      const out: KbPreviewSubject[] = [];
      for (const d of dirty) {
        const added: KbPreviewFile[] = [];
        const changed: KbPreviewFile[] = [];
        let est = 0;
        let needed = 0;
        for (const [list, target] of [[d.added, added], [d.changed, changed]] as const) {
          for (const i of list) {
            const fp = fingerprintOf(i.fileId, i.fingerprint);
            let needs = false;
            if (!known.has(fp) && !planned.has(fp)) {
              planned.add(fp);
              needs = true;
            }
            if (needs) {
              needed++;
              est += Math.ceil(i.chars / 3.5);
            }
            target.push({ fileId: i.fileId, name: i.name, academicYear: i.academicYear, chars: i.chars, needsDigest: needs });
          }
        }
        // PLAN (index + digests) and WRITE (~6k tokens per touched page), roughly.
        const pageCount = pageCounts.get(d.subjectId) ?? 0;
        const touched = d.added.length + d.changed.length + d.removed.length + (pageCount === 0 ? 1 : 0);
        est += 2000 + 150 * pageCount + 800 * (d.added.length + d.changed.length);
        est += 6000 * touched;
        total += est;
        out.push({
          subjectId: d.subjectId, subjectName: names.get(d.subjectId) ?? null, hasState: d.hasState, added, changed,
          removed: [...d.removed], digestsNeeded: needed, estimatedTokens: est,
        });
      }
      return { dirty: out, cleanSubjects: diffs.length - dirty.length, estimatedTokens: total, tokenBudget: s.runTokenBudget };
    });
  }

  // ==== KbRunHandler =================================================================

  handles(run: KbRun): boolean {
    return !run.isEval();
  }

  /**
   * DETECT: the dirty subjects. Admission: every dirty subject's whole cost is
   * estimated; subjects are taken smallest first while they fit the run's cost
   * budget; the rest are DEFERRED right here, never digested.
   */
  async detect(run: KbRun): Promise<void> {
    const s = await this.settings().effective();
    run.expectedCostUsd = await this.p.forecast().nextRunTotal(s);
    const dirty = (await inputs.diffs((id) => s.paused(id))).filter((d) => d.dirty());
    const estimates = await this.p.forecast().subjectEstimates(s, dirty);
    const compiledAt = new Map<string, Odt | null>();
    for (const st of await states.findAll()) compiledAt.set(st.subjectId, st.compiledAt);
    const candidates: Candidate[] = dirty.map((d) => {
      const e = estimates.get(d.subjectId)!;
      return { subjectId: d.subjectId, costUsd: e.costUsd, inputTokens: e.inputTokens, dirtySince: compiledAt.get(d.subjectId) ?? null };
    });
    const result = admit(candidates, s.runCostBudgetUsd, s.runTokenBudget);
    const order = [...result.admitted, ...result.deferred];
    const byId = new Map(dirty.map((d) => [d.subjectId, d]));
    const deferredIds = new Set(result.deferred.map((c) => c.subjectId));
    const n = order.length;
    for (let rank = 0; rank < n; rank++) {
      const c = order[rank]!;
      const d = byId.get(c.subjectId)!;
      const rs = new KbRunSubject(run.id, d.subjectId, s.writeModelFor(d.subjectId), n - rank, inputs.toJson(d.current),
        inputs.toJson(d.added), inputs.toJson(d.changed), [...d.removed]);
      if (deferredIds.has(c.subjectId)) {
        rs.status = 'DEFERRED';
        rs.error = `${BUDGET_REASON} (US$ ${usdText(c.costUsd)} estimado)`;
      }
      await runSubjects.save(rs);
    }
    const budget: JsonObject = {
      limitUsd: s.runCostBudgetUsd,
      estimatedUsd: usd(result.admittedUsd()),
      admitted: result.admitted.length,
      deferred: result.deferred.length,
      deferredEstimatedUsd: usd(result.deferredUsd()),
      tokenBudget: s.runTokenBudget,
    };
    if (result.oversized != null) budget.oversizedSubjectId = result.oversized.subjectId;
    run.stats = { budget };
    if (dirty.length === 0) {
      run.stage = 'DONE';
      run.finish('SUCCEEDED', this.now());
      this.log.info(`KB pipeline: run ${run.id}: nothing changed`);
    } else {
      run.stage = 'DIGEST';
      this.log.info(`KB pipeline: run ${run.id}: ${dirty.length} dirty subjects, ${result.admitted.length} admitted (US$${usd(result.admittedUsd()).toString()} of US$${s.runCostBudgetUsd.toString()}), ${result.deferred.length} deferred for budget${result.oversized == null ? '' : ` (${result.oversized.subjectId} alone: over budget)`}`);
    }
    await this.refreshSummary(run);
  }

  /** The subject admitted alone because it alone exceeds the cost budget: exempt from the token budget. */
  private exempt(run: KbRun, subjectId: string): boolean {
    return run.stats != null && subjectId === asText(path(path(run.stats, 'budget'), 'oversizedSubjectId'), null);
  }

  /**
   * Requests of the stage, within the run's token budget and the hard cap of
   * KB_RUN_MAX_REQUESTS_PER_STAGE (subjects that don't fit are DEFERRED and stay dirty).
   */
  async build(run: KbRun, stage: string, seq: Seq): Promise<number> {
    const s = await this.settings().effective();
    const cap = this.settings().maxRequestsPerStage();
    const active = (await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id)).filter((rs) => rs.isActive());
    let built = 0;
    const plannedFingerprints = new Set<string>();
    for (const rs of active) {
      try {
        const exempt = this.exempt(run, rs.subjectId);
        if (stage === 'DIGEST') {
          built += await this.buildDigest(run, rs, plannedFingerprints, seq, s, cap - built, exempt);
          continue;
        }
        const mine = stage === 'PLAN' ? await this.planRequests(run, rs, seq, s)
          : stage === 'WRITE' ? await this.writeRequests(run, rs, seq, s)
          : stage === 'RETRY' ? await this.retryRequests(run, rs, seq, s) : [];
        const est = mine.reduce((a, r) => a + r.estTokens, 0);
        if (!exempt && mine.length > 0 && run.estimatedTokens + est > s.runTokenBudget) {
          rs.status = 'DEFERRED';
          this.log.info(`KB pipeline: run ${run.id}: ${rs.subjectId} deferred (token budget)`);
          continue;
        }
        if (built + mine.length > cap) {
          rs.status = 'DEFERRED';
          this.log.info(`KB pipeline: run ${run.id}: ${rs.subjectId} deferred (request cap ${cap}: ${built} built, ${mine.length} more needed)`);
          continue;
        }
        run.addEstimated(est);
        await this.persist(mine);
        built += mine.length;
      } catch (e) {
        this.failSubject(run, rs, 'BUILD ' + stage, e);
      }
    }
    await this.refreshSummary(run);
    return built;
  }

  /** Saves requests and drops them from the persistence context. */
  private async persist(batch: KbRunRequest[]): Promise<void> {
    if (batch.length === 0) return;
    await requests.saveAll(batch);
    await requests.detach(batch);
  }

  async after(run: KbRun, stage: string): Promise<void> {
    const active = (await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id)).filter((rs) => rs.isActive());
    switch (stage) {
      case 'DIGEST':
        await this.storeDigests(run, active);
        run.stage = 'PLAN';
        break;
      case 'PLAN': {
        const dropped: JsonObject = {};
        for (const rs of active) {
          if (run.dryRun) continue; // dry: no LLM answers to use
          try {
            const rows = await requests.findByRunIdAndStageAndSubjectId(run.id, 'PLAN', rs.subjectId);
            if (rows.length > 0) await this.planAnswer(run, rs, rows[0]!, dropped); // else: no-LLM plan
            await requests.detach(rows);
          } catch (e) {
            this.failSubject(run, rs, 'PLAN', e);
          }
        }
        if (Object.keys(dropped).length > 0) {
          const stats = (isObject(run.stats) ? deepCopy(run.stats) : {}) as JsonObject;
          stats.droppedPlanOps = dropped;
          run.stats = stats;
        }
        if (run.dryRun) {
          for (const rs of active) if (rs.isActive()) rs.status = 'DRY';
          run.stage = 'DONE';
          await this.finishRun(run);
        } else {
          run.stage = 'WRITE';
        }
        break;
      }
      case 'WRITE':
      case 'RETRY': {
        const today = this.today();
        for (const rs of active) {
          try {
            const contents = new Map<string, string>();
            for (const [slug, d] of fields(rs.drafts)) {
              if (asText(path(d, 'origin')) === 'write') contents.set(slug, asText(path(d, 'content')));
            }
            const failed = new Map<string, string>();
            const rows = await requests.findByRunIdAndStageAndSubjectId(run.id, stage, rs.subjectId);
            for (const r of rows) {
              if (r.status !== 'DONE') {
                if (stage === 'WRITE') failed.set(r.target, 'no answer from the model: ' + r.error);
                continue;
              }
              const op = this.operation(rs, r.target);
              const markdown = isTextual(r.result) ? r.result : asText(path(r.result, 'markdown'), '')!;
              const type = (op == null ? 'CONCEPT' : upperRoot(asText(path(op, 'type'), 'concept')!)) as KbPageType;
              contents.set(r.target, normalizePage(markdown, rs.subjectId, type,
                op == null ? r.target : asText(path(op, 'title'), r.target)!, 'do:' + r.model, today));
            }
            await this.validateSubject(rs, contents, failed);
            await requests.detach(rows);
          } catch (e) {
            this.failSubject(run, rs, stage + ' validation', e);
          }
        }
        const retry = stage === 'WRITE' && (await this.settings().effective()).retryRejected
          && active.some((rs) => hasRejectedDraft(rs.drafts));
        run.stage = retry ? 'RETRY' : 'PUBLISH';
        break;
      }
      default:
    }
    await this.refreshSummary(run);
  }

  /** LocalDate.now(clock) in Buenos Aires. */
  private today(): string {
    const l = this.now().local();
    return `${String(l.year).padStart(4, '0')}-${String(l.month).padStart(2, '0')}-${String(l.day).padStart(2, '0')}`;
  }

  /** The PLAN answer of one subject: its validated operations, or the subject failed. */
  private async planAnswer(run: KbRun, rs: KbRunSubject, row: KbRunRequest, dropped: JsonObject): Promise<void> {
    if (row.status !== 'DONE') {
      rs.fail('PLAN: ' + row.error);
      return;
    }
    const proposed = path(row.result, 'operations');
    const check = new KbPlanCheck(proposed);
    const ops = this.validateOps(rs, proposed, await this.livePages(rs.subjectId), check);
    if (check.anyDropped()) {
      this.log.warn(`KB run ${run.id}: PLAN of ${rs.subjectId} (${row.model}) dropped operations: ${check.keptCount()} of ${check.proposed()} kept, dropped ${mapText(check.droppedByReason())}`);
      dropped[rs.subjectId] = check.toJson();
    }
    if (check.emptyAfterFiltering()) {
      rs.fail(`PLAN: ${EMPTY_PLAN_ERROR} (dropped ${mapText(check.droppedByReason())})`);
      return;
    }
    if (check.indexOnly()) {
      rs.fail('PLAN: ' + INDEX_ONLY_ERROR);
      return;
    }
    rs.operations = ops;
  }

  /** A PLAN whose operations were all dropped is asked once more with a corrective note. */
  async redo(run: KbRun, stage: string): Promise<string[]> {
    if (stage !== 'PLAN' || run.dryRun) return [];
    const active = new Map<string, KbRunSubject>();
    for (const rs of await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id)) {
      if (rs.isActive()) active.set(rs.subjectId, rs);
    }
    const out: string[] = [];
    const planIds = await requests.idsByRunAndStage(run.id, 'PLAN');
    for (let i = 0; i < planIds.length; i += REDO_PAGE) {
      const rows = await requests.findAllById(planIds.slice(i, i + REDO_PAGE));
      for (const r of rows) {
        const rs = active.get(r.subjectId);
        if (rs == null || r.status !== 'DONE') continue;
        const proposed = path(r.result, 'operations');
        const check = new KbPlanCheck(proposed);
        this.validateOps(rs, proposed, await this.livePages(rs.subjectId), check);
        if (!check.insufficient()) continue;
        const ids = elements(rs.inputs).map((inp) => asText(path(inp, 'fileId')));
        this.log.warn(`KB run ${run.id}: PLAN of ${rs.subjectId} (${r.model}) had no usable operation (${check.proposed()} proposed, dropped ${mapText(check.droppedByReason())}, index only: ${check.indexOnly()}); asking once more`);
        r.redo(this.p.payloads.withNote(r.params, correction(ids, check.indexOnly())));
        out.push(r.customId);
      }
      await requests.detach(rows);
    }
    return out;
  }

  /** PUBLISH: one transaction per subject; a failure leaves that subject dirty. */
  async complete(runId: string): Promise<void> {
    const ids = await inTx(this.db, async () => (await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId))
      .filter((rs) => rs.isActive()).map((rs) => rs.subjectId));
    for (const subjectId of ids) {
      try {
        const active = await inTx(this.db, async () => {
          const r = await runs.lockById(runId);
          if (r == null || !r.isActive()) return false;
          await this.publishSubject(runId, subjectId);
          return true;
        });
        if (!active) {
          this.log.info(`KB pipeline: run ${runId} cancelled during PUBLISH`);
          return;
        }
      } catch (e) {
        this.log.error({ err: e }, `KB pipeline: publishing ${subjectId} failed`);
        await inTx(this.db, async () => {
          const rs = await runSubjects.findById(runId, subjectId);
          if (rs) rs.fail('PUBLISH: ' + (e as Error).message);
        });
      }
    }
    await inTx(this.db, async () => {
      const run = (await runs.lockById(runId))!;
      if (!run.isActive()) return;
      run.stage = 'DONE';
      await this.finishRun(run);
      await this.refreshSummary(run);
      this.log.info(`KB pipeline: run ${runId} done (${run.tokensIn} in / ${run.tokensOut} out tokens, US$${run.costEstimate?.toString() ?? 'null'})`);
    });
  }

  /**
   * FAILED when every subject the run worked on failed, PARTIAL when some did or were
   * published with rejected pages, else SUCCEEDED (deferred and cancelled subjects don't count).
   */
  private async finishRun(run: KbRun): Promise<void> {
    const all = await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id);
    const worked = all.filter((rs) => rs.status !== 'DEFERRED' && rs.status !== 'CANCELLED');
    const failed = worked.filter((rs) => rs.status === 'FAILED').length;
    const partial = worked.filter((rs) => rs.status === 'PUBLISHED' && rs.error != null).length;
    const deferred = all.filter((rs) => rs.status === 'DEFERRED').length;
    const budgetDeferred = all.filter((rs) => rs.status === 'DEFERRED' && rs.error != null && rs.error.startsWith(BUDGET_REASON)).length;
    const completedN = all.filter((rs) => rs.status === 'PUBLISHED').length;
    // Deferred subjects stay dirty for the next run: not a clean success.
    const status = outcomeStatus(worked.length, failed, partial + deferred);
    if (status !== 'SUCCEEDED') {
      const parts: string[] = [];
      if (budgetDeferred > 0) parts.push(completedN + (completedN === 1 ? ' materia completada' : ' materias completadas'));
      if (failed > 0) parts.push(failed + (failed === 1 ? ' materia con fallas' : ' materias con fallas'));
      if (partial > 0) parts.push(partial + (partial === 1 ? ' materia parcial' : ' materias parciales'));
      if (budgetDeferred > 0) {
        const est = run.stats == null ? Dec.ZERO : decimalValue(path(path(run.stats, 'budget'), 'deferredEstimatedUsd'));
        parts.push(`${budgetDeferred}${budgetDeferred === 1 ? ' diferida' : ' diferidas'} por presupuesto (US$ ${usdText(est)} estimado)`);
      }
      const other = deferred - budgetDeferred;
      if (other > 0) parts.push(other + (other === 1 ? ' diferida' : ' diferidas'));
      run.error = parts.join(budgetDeferred > 0 ? ' · ' : ', ');
    }
    run.finish(status, this.now());
  }

  // ==== building requests =================================================================

  /**
   * DIGEST: chunks of added/changed files whose content has no digest yet (by
   * fingerprint). A subject that clearly does not fit the budget (by its texts'
   * lengths, read in SQL) is deferred without loading any text; otherwise its texts
   * are read DIGEST_PAGE files at a time.
   */
  private async buildDigest(run: KbRun, rs: KbRunSubject, planned: Set<string>, seq: Seq, s: KbEffectiveSettings, room: number,
    exempt: boolean): Promise<number> {
    const before = new Set(planned);
    const need = await this.digestTargets(rs, planned);
    if (need.length === 0) return 0;
    // Every file is at least one request: past the stage's request cap the subject is deferred.
    if (!exempt && need.length > room) {
      return this.defer(run, rs, planned, before, `request cap (${need.length} files, ${Math.max(room, 0)} requests left of ${this.settings().maxRequestsPerStage()})`);
    }
    const budget = s.runTokenBudget - run.estimatedTokens;
    let chars = 0;
    for (const page of pagesOf(need, ID_PAGE)) for (const [, len] of await files.textLengths(page)) chars += len;
    if (!exempt && Math.trunc((chars * 0.9) / 3.5) > budget) return this.defer(run, rs, planned, before, 'token budget');
    let est = 0;
    const saved: string[] = [];
    let truncated = false;
    for (const page of pagesOf(need, DIGEST_PAGE)) {
      const mine: KbRunRequest[] = [];
      const rows = (await files.textsOf(page)).sort((a, b) => cmp(a[0], b[0]));
      for (const [id, name, fingerprint, text] of rows) {
        const sentFingerprint = fingerprintOf(id, fingerprint);
        const chunks = chunksOf(text);
        // The dedicated run of an oversized subject digests whole files up to the request cap.
        if (exempt && saved.length + mine.length + chunks.length > room) {
          truncated = true;
          break;
        }
        for (let i = 0; i < chunks.length; i++) {
          const t = `Archivo: ${name} (parte ${i + 1}/${chunks.length})\n\n${chunks[i]}`;
          const params = await this.p.payloads.tunedFor(s.modelDigest, 'DIGEST', s, null, t);
          const r = this.p.engine.request(run, rs.subjectId, 'DIGEST', id, i, s.modelDigest, params, seq);
          r.contentFingerprint = sentFingerprint;
          mine.push(r);
        }
      }
      est += mine.reduce((a, r) => a + r.estTokens, 0);
      const overCap = saved.length + mine.length > room;
      if (!exempt && (est > budget || overCap)) {
        for (const ids of pagesOf(saved, ID_PAGE)) await requests.deleteByCustomIds(ids);
        return this.defer(run, rs, planned, before, overCap ? 'request cap' : 'token budget');
      }
      await this.persist(mine);
      for (const r of mine) saved.push(r.customId);
      if (truncated) break;
    }
    run.addEstimated(est);
    if (truncated) {
      // Its digests are stored after the stage; the subject itself waits.
      rs.status = 'DEFERRED';
      rs.error = `request cap: digest parcial (${saved.length} pedidos de ${need.length} archivos); continúa en la próxima corrida`;
      this.log.info(`KB pipeline: run ${run.id}: ${rs.subjectId} digest partial (request cap ${room}), continues next run`);
    }
    return saved.length;
  }

  private defer(run: KbRun, rs: KbRunSubject, planned: Set<string>, before: Set<string>, why: string): number {
    rs.status = 'DEFERRED';
    for (const fp of [...planned]) if (!before.has(fp)) planned.delete(fp);
    this.log.info(`KB pipeline: run ${run.id}: ${rs.subjectId} deferred (${why})`);
    return 0;
  }

  /** Files to digest (sorted by id), adding their fingerprints to `planned`. */
  private async digestTargets(rs: KbRunSubject, planned: Set<string>): Promise<string[]> {
    const candidates = [...elements(rs.added), ...elements(rs.changed)];
    if (candidates.length === 0) return [];
    const fps = new Set(candidates.map(inputFingerprint));
    const known = new Set<string>();
    // A partial digest (some chunks failed) is digested again, whole.
    for (const d of await digests.findByContentFingerprintInAndPromptVersion(fps, PROMPT_VERSION)) {
      if (!d.isPartial()) known.add(d.contentFingerprint);
    }
    const need: string[] = [];
    for (const c of candidates) {
      const fp = inputFingerprint(c);
      if (known.has(fp) || planned.has(fp)) continue;
      planned.add(fp);
      need.push(asText(path(c, 'fileId')));
    }
    return need.sort(cmp);
  }

  /**
   * PLAN: one request per subject, with its page index (no bodies), the digests of
   * added/changed files, removed files with their citing pages, and the page index of
   * up to 8 related subjects. Subjects with only removals whose citing pages lost every
   * source need no LLM.
   */
  private async planRequests(run: KbRun, rs: KbRunSubject, seq: Seq, s: KbEffectiveSettings): Promise<KbRunRequest[]> {
    const subjectId = rs.subjectId;
    const existing = await this.livePages(subjectId);
    const removed = new Set(elements(rs.removed).map((n) => asText(n)));
    const onlyRemovals = isEmpty(rs.added) && isEmpty(rs.changed);
    if (onlyRemovals) {
      const trivial = existing.filter((p) => p.sources.some((id) => removed.has(id)))
        .every((p) => p.sources.every((id) => removed.has(id)));
      if (trivial) {
        rs.operations = this.validateOps(rs, [], existing);
        return [];
      }
    }
    // Stable first (subject, its page index, related subjects), changes last.
    const pageArr: JsonValue[] = existing.map((p) => this.pageIndexEntry(p, true));
    const relatedArr: JsonValue[] = [];
    const stable: JsonObject = {
      subject: { id: subjectId, name: await this.subjectName(subjectId) },
      hasIndex: existing.some((p) => p.type === 'INDEX'),
      pages: pageArr,
      related: relatedArr,
    };
    let n = 0;
    for (const rel of await relations.findBySubject(subjectId)) {
      if (n >= 8) break;
      const relPages = (await this.livePages(rel.relatedId)).filter((p) => p.status === 'PUBLISHED');
      if (relPages.length === 0) continue;
      n++;
      relatedArr.push({
        subjectId: rel.relatedId,
        name: await this.subjectName(rel.relatedId),
        pages: relPages.map((p) => this.pageIndexEntry(p, false)),
      });
    }
    const changedArr: JsonValue[] = [];
    const removedArr: JsonValue[] = [];
    const body: JsonObject = { addedOrChanged: changedArr, removed: removedArr };
    const fileById = await this.fileMap(rs);
    const community = await this.communityIds([...fileById.keys()]);
    const digestByFp = await this.digestsFor(rs);
    for (const c of [...elements(rs.added), ...elements(rs.changed)]) {
      const fileId = asText(path(c, 'fileId'));
      const name = fileById.get(fileId) ?? null;
      const d = digestByFp.get(inputFingerprint(c));
      const o: JsonObject = {
        fileId,
        name,
        academicYear: path(c, 'academicYear') ?? null,
        community: name != null && community.has(fileId),
        digest: d == null ? null : d.digest,
      };
      if (d != null && d.isPartial()) o.partial = true; // some chunks could not be read: coverage may be incomplete
      changedArr.push(o);
    }
    const removedFiles = await files.names([...removed]);
    for (const id of removed) {
      removedArr.push({
        fileId: id,
        name: removedFiles.get(id) ?? '(archivo borrado)',
        citedBy: existing.filter((p) => p.sources.includes(id)).map((p) => p.slug),
      });
    }
    const model = s.planModelFor(subjectId);
    const params = await this.p.payloads.tunedFor(model, 'PLAN', s, this.p.payloads.toJson(stable), this.p.payloads.toJson(body));
    return [this.p.engine.request(run, subjectId, 'PLAN', subjectId, 0, model, params, seq)];
  }

  /** WRITE: one request per create/update operation; raw text only from the added/changed files the page draws on. */
  private async writeRequests(run: KbRun, rs: KbRunSubject, seq: Seq, s: KbEffectiveSettings): Promise<KbRunRequest[]> {
    const subjectId = rs.subjectId;
    const existing = await this.livePages(subjectId);
    const bySlug = new Map(existing.map((p) => [p.slug, p]));
    const changedIds = new Set([...elements(rs.added), ...elements(rs.changed)].map((c) => asText(path(c, 'fileId'))));
    const removed = new Set(elements(rs.removed).map((n) => asText(n)));
    const fileById = await this.fileMap(rs);
    const community = await this.communityIds([...fileById.keys()]);
    const digestByFp = await this.digestsFor(rs);
    const textById = await this.sourceTexts(rs.operations, changedIds);
    const inputById = new Map<string, JsonValue>();
    for (const i of elements(rs.inputs)) inputById.set(asText(path(i, 'fileId')), i);
    // Stable first (subject and its page index), the page's material last.
    const stable: JsonObject = {
      subject: { id: subjectId, name: await this.subjectName(subjectId) },
      pages: this.subjectIndex(existing, rs.operations),
    };
    const out: KbRunRequest[] = [];
    for (const op of elements(rs.operations)) {
      const kind = asText(path(op, 'op'));
      if (kind === 'delete') continue;
      const slug = asText(path(op, 'slug'));
      const current = bySlug.get(slug) ?? null;
      const changedSources: JsonValue[] = [];
      const keptSources: JsonValue[] = [];
      const excerpts: JsonValue[] = [];
      const removedArr: JsonValue[] = [];
      const body: JsonObject = {
        slug,
        type: asText(path(op, 'type')),
        title: asText(path(op, 'title')),
        reason: asText(path(op, 'reason'), '')!,
        mustCover: normalizeMustCover(path(op, 'mustCover')),
        changedSources,
        keptSources,
      };
      const sourceTexts: SourceText[] = [];
      const keywords = new Set<string>([asText(path(op, 'title'))]);
      for (const src of elements(path(op, 'sources'))) {
        const id = asText(src);
        const name = fileById.get(id) ?? id;
        const input = inputById.get(id) ?? {};
        if (changedIds.has(id)) {
          const d = digestByFp.get(inputFingerprint(input));
          changedSources.push({
            fileId: id, name, academicYear: path(input, 'academicYear') ?? null, community: community.has(id),
            digest: d == null ? null : d.digest,
          });
          if (d != null) for (const t of elements(path(d.digest, 'topics'))) keywords.add(asText(path(t, 'name')));
          if (textById.has(id)) sourceTexts.push({ fileId: id, name, text: textById.get(id)! });
        } else {
          keptSources.push({ fileId: id, name, community: community.has(id), academicYear: path(input, 'academicYear') ?? null });
        }
      }
      body.excerpts = excerpts;
      for (const e of excerptsOf(sourceTexts, keywords)) excerpts.push({ fileId: e.fileId, name: e.name, text: e.text });
      body.removedSources = removedArr;
      if (current != null) for (const id of current.sources) if (removed.has(id)) removedArr.push(id);
      body.currentPage = current == null ? null : pageFile(current);
      const model = s.writeModelFor(subjectId);
      const params = await this.p.payloads.tunedFor(model, 'WRITE', s, this.p.payloads.toJson(stable), this.p.payloads.toJson(body));
      out.push(this.p.engine.request(run, subjectId, 'WRITE', slug, 0, model, params, seq));
    }
    return out;
  }

  /** RETRY: the rejected drafts with their validator errors. */
  private async retryRequests(run: KbRun, rs: KbRunSubject, seq: Seq, s: KbEffectiveSettings): Promise<KbRunRequest[]> {
    if (!s.retryRejected) return [];
    const out: KbRunRequest[] = [];
    const fileById = await this.fileMap(rs);
    const allowed: JsonValue[] = elements(rs.inputs).map((i) => {
      const id = asText(path(i, 'fileId'));
      return { fileId: id, name: fileById.get(id) ?? null };
    });
    const stable: JsonObject = {
      subject: { id: rs.subjectId, name: await this.subjectName(rs.subjectId) },
      pages: this.subjectIndex(await this.livePages(rs.subjectId), rs.operations),
    };
    for (const [slug, d] of fields(rs.drafts)) {
      if (asText(path(d, 'origin')) !== 'write' || isEmpty(path(d, 'errors'))) continue;
      const body: JsonObject = { slug, errors: path(d, 'errors') ?? null };
      const retryOp = this.operation(rs, slug);
      if (retryOp != null) body.mustCover = normalizeMustCover(path(retryOp, 'mustCover'));
      body.page = asText(path(d, 'content'));
      body.allowedSources = allowed;
      const model = s.retryModelFor(rs.subjectId);
      const params = await this.p.payloads.tunedFor(model, 'RETRY', s, this.p.payloads.toJson(stable), this.p.payloads.toJson(body));
      out.push(this.p.engine.request(run, rs.subjectId, 'RETRY', slug, 0, model, params, seq));
    }
    return out;
  }

  // ==== after each stage ======================================================================

  /**
   * Merges each fully digested content into kb_file_digest, under the fingerprint that
   * was actually sent. Then every subject needs a digest for each added/changed input
   * (by the fingerprint DETECT saw).
   */
  private async storeDigests(run: KbRun, active: KbRunSubject[]): Promise<void> {
    if (run.dryRun) return;
    const ids = await requests.idsByRunAndStage(run.id, 'DIGEST');
    let groupKey: string | null = null;
    let group: KbRunRequest[] = [];
    for (let i = 0; i < ids.length; i += DIGEST_PAGE * 5) {
      const rows = (await requests.findAllById(ids.slice(i, i + DIGEST_PAGE * 5))).sort((a, b) => cmp(a.customId, b.customId));
      for (const r of rows) {
        let fp = r.contentFingerprint;
        if (fp == null) {
          const f = await files.fingerprintOf(r.target);
          fp = f == null ? 'file:' + r.target : fingerprintOf(f.id, f.fingerprint);
        }
        const key = r.target + '|' + fp;
        if (key !== groupKey) {
          await this.storeDigest(groupKey, group);
          group = [];
          groupKey = key;
        }
        group.push(r);
      }
      await requests.detach(rows);
    }
    await this.storeDigest(groupKey, group);
    for (const rs of active) {
      try {
        const missing = new Set<string>();
        const have = await this.digestsFor(rs);
        for (const c of [...elements(rs.added), ...elements(rs.changed)]) {
          if (!have.has(inputFingerprint(c))) missing.add(asText(path(c, 'fileId')));
        }
        if (missing.size === 0) continue;
        const sorted = [...missing].sort(cmp);
        const total = size(rs.added) + size(rs.changed);
        const tolerated = tolerableMissing(sorted, total, this.settings().digestMaxMissingRatio());
        if (tolerated == null) rs.fail(`DIGEST failed (or the file changed during the run) for [${sorted.join(', ')}]`);
        else this.skipUnread(rs, sorted);
      } catch (e) {
        this.failSubject(run, rs, 'DIGEST', e);
      }
    }
  }

  /** One subject's failure never stops the run: only it is FAILED, with a short reason. */
  private failSubject(run: KbRun, rs: KbRunSubject, stage: string, e: unknown): void {
    this.log.warn({ err: e }, `KB run ${run.id}: ${rs.subjectId} failed at ${stage}: ${String(e)}`);
    const msg = e instanceof Error && e.message ? e.message : javaSimpleName(e);
    rs.fail(`${stage}: ${msg.length > 300 ? msg.substring(0, 300) + '...' : msg}`);
  }

  /** The subject goes on without its unread files (never planned, written, cited or recorded as compiled). */
  private skipUnread(rs: KbRunSubject, missing: string[]): void {
    const set = new Set(missing);
    const without = (n: JsonValue): JsonValue[] => elements(n).filter((i) => !set.has(asText(path(i, 'fileId'))));
    rs.skip([...missing], without(rs.inputs), without(rs.added), without(rs.changed));
    this.log.warn(`KB pipeline: ${rs.subjectId} goes on without ${missing.length} unread file(s) [${missing.join(', ')}]`);
  }

  /** One file's chunks (all DONE) become its kb_file_digest, unless one exists. */
  private async storeDigest(key: string | null, group: KbRunRequest[]): Promise<void> {
    if (key == null || group.length === 0) return;
    const chunks = [...group].sort((a, b) => a.chunk - b.chunk);
    // Chunks that failed leave a gap: the digest of the rest is stored flagged partial.
    const results = chunks.map((c) => (c.status === 'DONE' ? c.result : null));
    if (results.every((r) => r == null)) return;
    const fp = key.substring(key.indexOf('|') + 1);
    const existing = await digests.findByContentFingerprintInAndPromptVersion([fp], PROMPT_VERSION);
    if (existing.some((d) => !d.isPartial())) return;
    const tin = chunks.reduce((a, c) => a + c.tokensIn, 0);
    const tout = chunks.reduce((a, c) => a + c.tokensOut, 0);
    const merged = mergePartial(results);
    if (existing.length > 0) {
      const d = existing[0]!;
      d.replace(chunks[0]!.model, merged, tin, tout);
      await digests.save(d);
      await digests.detach(d);
      return;
    }
    const fileId = chunks[0]!.target;
    const saved = await digests.save(new KbFileDigest((await files.existsById(fileId)) ? fileId : null, fp, PROMPT_VERSION,
      chunks[0]!.model, merged, tin, tout));
    await digests.detach(saved);
  }

  /**
   * The PLAN's operations made safe: known slugs only, sources limited to the subject's
   * current inputs, creates of existing slugs become updates; pages that lost all their
   * sources are deleted and pages that lost some are updated even if the model forgot them.
   */
  validateOps(rs: KbRunSubject, proposed: JsonValue | undefined, existing: KbPageView[], check: KbPlanCheck = new KbPlanCheck(proposed)): JsonValue[] {
    const valid = new Set(elements(rs.inputs).map((i) => asText(path(i, 'fileId'))));
    const bySlug = new Map(existing.map((p) => [p.slug, p]));
    const out: JsonValue[] = [];
    const seen = new Set<string>();
    if (existing.length === 0) check.firstCompile(valid.size);
    for (const op of elements(proposed)) {
      let kind = lowerRoot(asText(path(op, 'op'), '')!);
      const slug = normalizeIndexSlug(jTrim(asText(path(op, 'slug'), '')!), asText(path(op, 'type'), ''));
      if (!SLUG.test(slug) || slug === 'graph') {
        check.dropped(INVALID_SLUG);
        continue;
      }
      if (seen.has(slug)) {
        check.dropped(DUPLICATE_SLUG);
        continue;
      }
      seen.add(slug);
      const current = bySlug.get(slug) ?? null;
      if (kind === 'create' && current != null) kind = 'update';
      if (!['create', 'update', 'delete'].includes(kind)) {
        check.dropped(INVALID_OP);
        continue;
      }
      if (kind !== 'create' && current == null) {
        check.dropped(UNKNOWN_PAGE);
        continue;
      }
      if (kind === 'delete') {
        out.push({ op: kind, slug, reason: asText(path(op, 'reason'), '')!, mustCover: [] });
        check.kept();
        continue;
      }
      let type = current != null ? current.wire() : slug === 'index' ? 'index' : asText(path(op, 'type'), 'concept')!;
      if (!['topic', 'concept', 'index'].includes(type) || (type === 'index') !== (slug === 'index')) {
        type = slug === 'index' ? 'index' : 'concept';
      }
      const title = jIsBlank(asText(path(op, 'title'), '')!)
        ? (current != null ? current.title : slug.replaceAll('-', ' '))
        : jTrim(asText(path(op, 'title')));
      const sources: string[] = [];
      for (const sNode of elements(path(op, 'sources'))) if (valid.has(asText(sNode))) sources.push(asText(sNode));
      if (sources.length === 0 && current != null) {
        for (const id of current.sources) if (valid.has(id)) sources.push(id);
      }
      if (sources.length === 0) {
        check.droppedForSources(path(op, 'sources'));
        continue;
      }
      out.push({
        op: kind, slug, type, title, sources, reason: asText(path(op, 'reason'), '')!,
        mustCover: normalizeMustCover(path(op, 'mustCover')),
      });
      check.keptPage(slug);
    }
    const removed = new Set(elements(rs.removed).map((n) => asText(n)));
    for (const p of existing) {
      if (seen.has(p.slug)) continue;
      const ids = p.sources;
      if (!ids.some((id) => removed.has(id))) continue;
      const left = ids.filter((id) => valid.has(id));
      if (left.length === 0) {
        out.push({ slug: p.slug, op: 'delete', reason: 'lost all its sources' });
      } else {
        out.push({ slug: p.slug, op: 'update', type: p.wire(), title: p.title, sources: left, reason: 'drop removed sources' });
      }
      seen.add(p.slug);
    }
    return out;
  }

  /**
   * LINK + VALIDATE: links the drafts and the subject's unchanged pages (deterministic
   * linker), then validates them as an import would. drafts jsonb:
   * {slug: {content, origin: write|link|failed, errors}}.
   */
  private async validateSubject(rs: KbRunSubject, contents: Map<string, string>, failed: Map<string, string>): Promise<void> {
    const subjectId = rs.subjectId;
    const deletes = new Set<string>();
    for (const op of elements(rs.operations)) if (asText(path(op, 'op')) === 'delete') deletes.add(asText(path(op, 'slug')));
    const existing = await this.livePages(subjectId);
    const targets = new Map<string, Target>();
    for (const p of existing) {
      if (!deletes.has(p.slug)) targets.set(p.slug, { slug: p.slug, title: p.title, aliases: p.aliases });
    }
    for (const [slug, content] of contents) {
      const fm = splitPage(content).frontmatter;
      const title = fm == null ? slug : javaValueOf(fm.title);
      const aliases: string[] = [];
      if (fm != null && Array.isArray(fm.aliases)) for (const a of fm.aliases) aliases.push(javaValueOf(a));
      targets.set(slug, { slug, title, aliases });
    }
    const targetList = [...targets.keys()].sort(cmp).map((k) => targets.get(k)!);

    const payload: KbImportPage[] = [];
    const origin = new Map<string, string>();
    const linked = new Map<string, string>();
    for (const [slug, content] of contents) {
      const body = splitPage(content).body;
      linked.set(slug, replaceBody(content, link(body, slug, targetList).body));
      origin.set(slug, 'write');
    }
    for (const p of existing) {
      if (contents.has(p.slug) || deletes.has(p.slug)) continue;
      const result = link(p.markdown, p.slug, targetList);
      if (result.addedSlugs.length === 0) continue;
      linked.set(p.slug, replaceBody(pageFile(p), result.body));
      origin.set(p.slug, 'link');
    }
    for (const [slug, content] of linked) payload.push({ path: slug + '.md', content });
    const v = await this.importer().validate(subjectId, payload, deletes, await this.flushedTx());

    const errorsBySlug = new Map<string, string[]>();
    for (const r of v.rejected) errorsBySlug.set(r.slug, [...r.errors]);
    for (const [slug, content] of linked) {
      if (origin.get(slug) !== 'write') continue;
      const op = this.operation(rs, slug);
      if (op == null) continue;
      const missing = missingFormulaErrors(path(op, 'mustCover'), splitPage(content).body);
      if (missing.length > 0) {
        let l = errorsBySlug.get(slug);
        if (!l) errorsBySlug.set(slug, (l = []));
        l.push(...missing);
      }
    }
    const drafts: JsonObject = {};
    for (const [slug, content] of linked) {
      drafts[slug] = { content, origin: origin.get(slug)!, errors: [...(errorsBySlug.get(slug) ?? [])] };
    }
    for (const [slug, why] of failed) drafts[slug] = { content: null, origin: 'failed', errors: [why] };
    rs.drafts = drafts;
  }

  /** The current drizzle transaction, with the pending entity changes written (FlushMode.AUTO). */
  private async flushedTx(): Promise<DbTx> {
    const s = session();
    await s.flush();
    return s.tx;
  }

  private importer(): KbImporterPort {
    const i = this.p.importer();
    if (i == null) throw new Error('KbImportService is not available (no importer registered with provideKbCollaborators)');
    return i;
  }

  // ==== PUBLISH ===============================================================================

  private async publishSubject(runId: string, subjectId: string): Promise<void> {
    let rs = (await runSubjects.findById(runId, subjectId))!;
    const deleted: string[] = [];
    for (const op of elements(rs.operations)) {
      if (asText(path(op, 'op')) !== 'delete') continue;
      const slug = asText(path(op, 'slug'));
      const p = await pages.findBySubjectIdAndSlug(subjectId, slug);
      if (p != null && p.status !== 'REMOVED') {
        p.setStatus('REMOVED');
        deleted.push(slug);
      }
    }
    const payload: KbImportPage[] = [];
    const rejected: JsonValue[] = [];
    for (const [slug, d] of fields(rs.drafts)) {
      if (isEmpty(path(d, 'errors')) && hasNonNull(d, 'content')) {
        payload.push({ path: slug + '.md', content: asText(path(d, 'content')) });
      } else if (asText(path(d, 'origin')) !== 'link') {
        rejected.push({ slug, errors: path(d, 'errors') ?? null });
      }
    }
    const accepted: string[] = [];
    if (payload.length > 0) {
      const res = await this.importer().importSubject(subjectId, { pages: payload, replace: false }, await this.flushedTx());
      rs = (await runSubjects.findById(runId, subjectId))!;
      accepted.push(...res.accepted);
      for (const r of res.rejected) rejected.push({ slug: r.slug, errors: [...r.errors] });
      // Rewritten without the taken-down source: back to readers.
      for (const slug of res.accepted) {
        const p = await pages.findBySubjectIdAndSlug(subjectId, slug);
        if (p != null && p.status === 'HIDDEN' && p.hiddenReason === 'TAKEDOWN') p.setStatus('PUBLISHED');
      }
    }
    // Only what made it in counts as compiled.
    const acceptedSlugs = new Set(accepted);
    const tainted = new Set<string>();
    let writes = 0;
    let failedWrites = 0;
    for (const op of elements(rs.operations)) {
      if (asText(path(op, 'op')) === 'delete') continue;
      writes++;
      const slug = asText(path(op, 'slug'));
      if (acceptedSlugs.has(slug)) continue;
      failedWrites++;
      for (const src of elements(path(op, 'sources'))) tainted.add(asText(src));
      const p = await pages.findBySubjectIdAndSlug(subjectId, slug);
      if (p != null) for (const id of p.sources) tainted.add(id);
    }
    // Files left out for lack of a digest are never recorded as compiled.
    for (const id of elements(rs.skipped)) tainted.add(asText(id));
    const state = (await states.findById(subjectId)) ?? new KbSubjectState(subjectId);
    const compiled = compiledInputs(state.inputs, rs.inputs, tainted);
    state.compiled(inputs.hash(compiled), compiled, this.now(), runId);
    await states.save(state);
    rs.setOutcome(accepted, rejected, deleted);
    if (failedWrites === 0) {
      rs.status = 'PUBLISHED';
    } else if (failedWrites === writes && deleted.length === 0) {
      rs.fail('PUBLISH: every page was rejected or got no answer; the changes stay pending');
    } else {
      rs.status = 'PUBLISHED';
      rs.error = `${failedWrites} of ${writes} pages rejected or unanswered; their inputs stay pending`;
    }
    if (rs.status === 'PUBLISHED' && size(rs.skipped) > 0) {
      const note = skippedNote(size(rs.skipped));
      rs.error = rs.error == null ? note : rs.error + '; ' + note;
    }
    this.log.info(`KB pipeline: ${subjectId} published (${accepted.length} pages, ${rejected.length} rejected, ${deleted.length} deleted, ${failedWrites} writes failed)`);
  }

  // ==== helpers ===================================================================================

  private async livePages(subjectId: string): Promise<KbPageView[]> {
    return (await pages.findBySubjectIdAndStatusIn(subjectId, ['PUBLISHED', 'HIDDEN'])).sort((a, b) => cmp(a.slug, b.slug));
  }

  private pageIndexEntry(p: KbPageView, withSources: boolean): JsonObject {
    const o: JsonObject = { slug: p.slug, type: p.wire(), title: p.title, summary: p.summary, aliases: [...p.aliases] };
    if (withSources) o.sources = [...p.sources];
    return o;
  }

  /** The subject's pages for links/anchors: existing pages (with heading anchors) and the ones the plan creates. */
  private subjectIndex(existing: KbPageView[], ops: JsonValue): JsonValue[] {
    const arr: JsonValue[] = [];
    const deleted = new Set<string>();
    for (const op of elements(ops)) if (asText(path(op, 'op')) === 'delete') deleted.add(asText(path(op, 'slug')));
    const slugs = new Set<string>();
    for (const p of existing) {
      if (deleted.has(p.slug)) continue;
      slugs.add(p.slug);
      arr.push({ slug: p.slug, title: p.title, aliases: [...p.aliases], anchors: [...headingAnchors(p.markdown)] });
    }
    for (const op of elements(ops)) {
      if (asText(path(op, 'op')) !== 'create' || slugs.has(asText(path(op, 'slug')))) continue;
      arr.push({ slug: asText(path(op, 'slug')), title: asText(path(op, 'title')), aliases: [], anchors: [] });
    }
    return arr;
  }

  private operation(rs: KbRunSubject, slug: string): JsonValue | null {
    for (const op of elements(rs.operations)) if (asText(path(op, 'slug')) === slug) return op;
    return null;
  }

  /** Files of community archives (older material). */
  private async communityIds(ids: string[]): Promise<Set<string>> {
    return ids.length === 0 ? new Set() : new Set(await files.findCommunityFileIds(ids));
  }

  /** A subject input's id -> name (never its text). */
  private async fileMap(rs: KbRunSubject): Promise<Map<string, string>> {
    const ids = elements(rs.inputs).map((i) => asText(path(i, 'fileId')));
    const out = new Map<string, string>();
    for (const page of pagesOf(ids, ID_PAGE)) for (const [id, name] of await files.namesOf(page)) out.set(id, name);
    return out;
  }

  /** Raw text of the changed files the subject's operations draw on (WRITE). */
  private async sourceTexts(operations: JsonValue, changedIds: Set<string>): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const op of elements(operations)) {
      for (const src of elements(path(op, 'sources'))) if (changedIds.has(asText(src))) ids.add(asText(src));
    }
    const out = new Map<string, string>();
    for (const page of pagesOf([...ids].sort(cmp), DIGEST_PAGE)) {
      for (const [id, , , text] of await files.textsOf(page)) if (text != null) out.set(id, text);
    }
    return out;
  }

  private async digestsFor(rs: KbRunSubject): Promise<Map<string, KbFileDigest>> {
    const fps = new Set([...elements(rs.added), ...elements(rs.changed)].map(inputFingerprint));
    const out = new Map<string, KbFileDigest>();
    if (fps.size === 0) return out;
    for (const d of await digests.findByContentFingerprintInAndPromptVersion(fps, PROMPT_VERSION)) {
      if (!out.has(d.contentFingerprint)) out.set(d.contentFingerprint, d);
    }
    return out;
  }

  private async subjectName(id: string): Promise<string> {
    return (await subjects.name(id)) ?? id;
  }

  /** Progress summary: best effort, never fails a stage. */
  private async refreshSummary(run: KbRun): Promise<void> {
    try {
      const arr: JsonValue[] = [];
      for (const s of await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id)) {
        arr.push({
          subjectId: s.subjectId, status: s.status, added: size(s.added), changed: size(s.changed), removed: size(s.removed),
          operations: size(s.operations), accepted: size(s.accepted), rejected: size(s.rejected),
        });
      }
      run.subjects = arr;
      const byStage: JsonObject = {};
      for (const st of ['DIGEST', 'PLAN', 'WRITE', 'RETRY']) {
        const n = await requests.countByRunIdAndStage(run.id, st);
        if (n > 0) byStage[st] = n;
      }
      const stats: JsonObject = { requests: byStage, estimatedTokens: run.estimatedTokens };
      if (run.stats != null && has(run.stats, 'budget')) stats.budget = path(run.stats, 'budget')!;
      if (run.stats != null && has(run.stats, 'droppedPlanOps')) stats.droppedPlanOps = path(run.stats, 'droppedPlanOps')!;
      run.stats = stats;
    } catch (e) {
      this.log.warn(`KB run ${run.id}: progress summary not refreshed: ${(e as Error).message}`);
    }
  }

  private async summary(r: KbRun, full: boolean): Promise<KbRunResponse> {
    return {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      stage: r.stage,
      dryRun: r.dryRun,
      promptVersion: r.promptVersion,
      model: r.model,
      startedAt: odtJson(r.startedAt),
      finishedAt: odtJson(r.finishedAt),
      estimatedTokens: r.estimatedTokens,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      tokensCached: r.tokensCached,
      costEstimate: r.costEstimate,
      costUsd: usd(r.costEstimate),
      expectedCostUsd: r.expectedCostUsd,
      costByStage: full ? await this.costByStage(r) : null,
      costApproved: r.costApproved,
      simulated: r.simulated,
      error: r.error,
      subjects: full ? await this.subjectsOf(r) : null,
      batches: full ? await this.batchesOf(r) : null,
      progress: full ? await this.p.progress.progress(r.id) : null,
      budget: this.budgetOf(r),
    };
  }

  private budgetOf(r: KbRun): KbRunBudgetResponse | null {
    const b = r.stats == null ? undefined : path(r.stats, 'budget');
    if (b === undefined || b === null) return null;
    return {
      limitUsd: decimalValue(path(b, 'limitUsd')),
      estimatedUsd: decimalValue(path(b, 'estimatedUsd')),
      spentUsd: usd(r.costEstimate),
      admitted: asInt(path(b, 'admitted')),
      deferred: asInt(path(b, 'deferred')),
      deferredEstimatedUsd: decimalValue(path(b, 'deferredEstimatedUsd')),
      tokenBudget: asLong(path(b, 'tokenBudget')),
      oversizedSubjectId: asText(path(b, 'oversizedSubjectId'), null),
    };
  }

  private async costByStage(r: KbRun): Promise<Record<string, Dec>> {
    const out: Record<string, Dec> = {};
    for (const st of ['DIGEST', 'PLAN', 'WRITE', 'RETRY']) out[st] = Dec.ZERO.setScale(4);
    for (const j of await jobs.findByRunIdOrderByCreatedAtAsc(r.id)) {
      if (j.costEstimate != null) out[j.stage] = (out[j.stage] ?? Dec.ZERO).add(j.costEstimate);
    }
    for (const k of Object.keys(out)) out[k] = usd(out[k]!);
    return out;
  }

  private async subjectsOf(r: KbRun): Promise<KbRunSubjectResponse[]> {
    const list = await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(r.id);
    const names = await subjects.names(list.map((s) => s.subjectId));
    return list.map((s) => ({
      subjectId: s.subjectId,
      subjectName: names.get(s.subjectId) ?? null,
      status: s.status,
      model: s.model,
      added: elements(s.added).map((i) => asText(path(i, 'fileId'))),
      changed: elements(s.changed).map((i) => asText(path(i, 'fileId'))),
      removed: elements(s.removed).map((i) => asText(i)),
      operations: s.operations,
      accepted: s.accepted,
      rejected: s.rejected,
      deleted: s.deleted,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCached: s.tokensCached,
      costEstimate: s.costEstimate,
      costUsd: usd(s.costEstimate),
      error: s.error,
      droppedPlanOps: r.stats == null ? null : (path(path(r.stats, 'droppedPlanOps'), s.subjectId) ?? null),
      skippedFiles: s.skippedCount(),
    }));
  }

  private async batchesOf(r: KbRun): Promise<KbBatchJobResponse[]> {
    return (await jobs.findByRunIdOrderByCreatedAtAsc(r.id)).map((j) => ({
      id: j.id!, stage: j.stage, attempt: j.attempt, model: j.model, mode: j.mode, status: j.status,
      requestCount: j.requestCount, doBatchId: j.doBatchId, payloadKey: j.payloadKey, outputKey: j.outputKey,
      tokensIn: j.tokensIn, tokensOut: j.tokensOut, tokensCached: j.tokensCached, costEstimate: j.costEstimate,
      costUsd: usd(j.costEstimate), submittedAt: odtJson(j.submittedAt), completedAt: odtJson(j.completedAt), error: j.error,
      nextAttemptAt: odtJson(j.nextAttemptAt),
    }));
  }
}

