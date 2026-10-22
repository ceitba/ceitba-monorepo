// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbRunEngine.java (with
// KbRunHandler and the kick side of scheduling/KbPipelineJob).
//
// Runs the stages of pipeline runs and evaluations (KbRunHandler), kept
// entirely in the database so a restart resumes where it stopped:
//
//   build requests (budget/cost limit) -> store the canonical JSONL in
//   storage (kb/runs/<runId>/<stage>[-<attempt>][-<n>].jsonl, same in both
//   modes) -> execute per model, BATCH (DO batch, polled) or SYNC (chat
//   completions, each result persisted as it arrives) -> record every
//   result (request row, kb_llm_usage with its frozen cost, run/stage/
//   subject totals) -> resubmit once what got no answer -> handler.after.
//
// The mode is chosen per model at submission from the runtime settings, so a
// settings change applies to the next stage, never to one in flight.
//
// Differences from Java, by design: JSONL payloads and sync outputs are built in
// memory instead of temp files (the storage port takes bytes); the record lock is
// a promise mutex; Java's virtual-thread heartbeat is a timer.

import type { Database } from '../../db/client';
import type { Logger } from '../../infra/logger';
import type { ObjectStorage } from '../../infra/storage';
import { ApiError, ResourceNotFoundError } from '../../http/errors';
import { Dec } from '../kb/logic/decimal';
import { classifyFailure } from '../kb/logic/external/doBatchErrors';
import { DAILY_RETRY_SEC } from '../kb/logic/external/doQuotaTracker';
import { LlmApiError, type BatchInfo } from '../kb/logic/external/llmApi';
import { parse as parseOutput, type LlmResult } from '../kb/logic/external/llmOutputParser';
import type { BatchLlmExecutor } from '../kb/logic/llm/batchLlmExecutor';
import type { KbLlmRouter } from '../kb/logic/llm/kbLlmRouter';
import type { KbUsageRecorder } from '../kb/logic/llm/kbUsageRecorder';
import { MAX_TOKENS_CAP, type Outcome as SyncOutcome, type SyncLlmExecutor } from '../kb/logic/llm/syncLlmExecutor';
import { deepCopy, isObject, isArray, nodeToString, path, readTree, type JsonObject, type JsonValue } from '../kb/logic/jsonNode';
import { ART_ZONE, formatHHmm, type Now, type Odt } from '../kb/logic/odt';
import { estimateTokens } from '../kb/logic/pipeline/kbPayloads';
import { pagedLines, split, type KbBatchSubmitter } from '../kb/logic/pipeline/kbBatchSubmitter';
import { KbPipelineError } from '../kb/logic/pipeline/kbPipelineError';
import type { KbRunRequestStore } from '../kb/logic/ports';
import { KbBatchJob, KbRunRequest } from '../kb/logic/types';
import type { KbSettingsPort } from './collaborators';
import type { KbRun } from './db/entities';
import { jobs, requests, runs, runSubjects, type ResumeCounter } from './db/repo';
import { inTx, outsideTx, txRunner } from './db/session';
import type { KbCostService } from './costs';

export const ACTIVE = ['RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT'] as const;
/** Statuses a RUNNING <-> WAITING toggle may move from. */
export const MOVING = ['RUNNING', 'WAITING'] as const;
export const LLM_STAGES = ['DIGEST', 'PLAN', 'WRITE', 'RETRY'];
export const MAX_STEPS = 200;
export const JSONL_PAGE = 50;
/** Requests loaded per page wherever a stage's requests are walked. */
export const PAGE = 200;
/**
 * Restart-loop guard: a RUNNING run resumed by more than MAX_RESUMES startups inside RESUME_WINDOW is failed.
 * Only startups that find the run still leased count (its advancer never released it), and a release
 * undoes what was counted while the holder was alive, so graceful restarts and blue/green deploys
 * never add up (see registerResume and docs/SUBJECT-WIKI-PIPELINE.md "Restart-loop guard").
 */
export const MAX_RESUMES = 3;
export const RESUME_WINDOW_MIN = 30;
export const RESUME_LOOP_ERROR = 'detenida tras reinicios repetidos (posible falta de memoria)';
export const QUOTA_PAUSE_PREFIX = 'Cupo diario';
export const QUOTA_PAUSE = 'Cupo diario de tokens de DigitalOcean agotado; reintento a las ';
export const LEASE_MS = 3 * 60_000;
export const CANCEL_CHECK_MS = 5_000;
export const LEASE_RENEW_MS = 60_000;
export const MAX_STEP_FAILURES = 4;
/**
 * On shutdown, how long stop() waits for running advances (in-flight sync requests) before it
 * releases their leases anyway: under the 60 s executor phase and compose's 90 s stop_grace_period.
 */
export const STOP_WAIT_MS = 45_000;
/** Batch answers recorded per transaction. */
export const RECORD_PAGE = 100;

/** Sequence for custom ids within a run. */
export class Seq {
  constructor(private value: number) {}
  next(): number {
    return ++this.value;
  }
}

/**
 * What a kind of run does at each stage (service/kb/pipeline/KbRunHandler); the
 * engine does the rest. Implemented by the pipeline and evaluations.
 *   DETECT -> DIGEST -> PLAN -> WRITE -> RETRY -> <final stage> -> DONE
 * detect/build/after run inside the engine's transaction (the run row locked);
 * complete manages its own transactions.
 */
export interface KbRunHandler {
  handles(run: KbRun): boolean;
  /** First stage: decide the work (and set the next stage). */
  detect(run: KbRun): Promise<void>;
  /** Creates the stage's requests (engine.request), returns how many. */
  build(run: KbRun, stage: string, seq: Seq): Promise<number>;
  /** Uses the stage's results and sets the next stage. */
  after(run: KbRun, stage: string): Promise<void>;
  /** Answered requests to send once more (already reset with redo(params)), as custom ids. */
  redo?(run: KbRun, stage: string): Promise<string[]>;
  /** The final, non-LLM stage (PUBLISH / REPORT). */
  complete(runId: string): Promise<void>;
  /** kb_llm_usage.stage for a request of `stage` (evals record EVAL). */
  usageStage?(stage: string): string;
  /** Whether the weekly cost limit applies (default true). */
  costLimited?(): boolean;
}

/** A lease this engine holds: its token, heartbeat and the resume counter as it was when taken. */
interface HeldLease {
  token: string;
  heartbeat: ReturnType<typeof setInterval>;
  kept: ResumeCounter;
}

interface StepFailure {
  stage: string;
  count: number;
  nextAt: Odt;
}

/** A promise mutex (Java's ReentrantLock around recording). */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function emptyOrTruncated(error: string | null): boolean {
  return error != null && (error.startsWith('EMPTY_TOOL') || error.startsWith('TRUNCATED'));
}

/** DO's error_message of a batch that did not complete (else its status). */
export function batchError(info: BatchInfo): string {
  if (info.errorMessage != null && info.errorMessage.trim() !== '') {
    return `DigitalOcean batch ${info.status}: ${info.errorMessage}`;
  }
  return `DigitalOcean batch ${info.status}`;
}

function stripReasoning(node: JsonValue): void {
  if (isObject(node)) {
    delete node.reasoning_content;
    for (const v of Object.values(node)) stripReasoning(v);
  } else if (isArray(node)) {
    for (const v of node) stripReasoning(v);
  }
}

/**
 * Java's getClass().getSimpleName() of an exception: the ported domain errors
 * (src/http/errors.ts, XxxError for Java's XxxException) carry the Java name; other
 * errors (driver, runtime) keep their JS name.
 */
export function javaSimpleName(e: unknown): string {
  if (!(e instanceof Error)) return 'RuntimeException';
  const name = e.name === 'Error' ? e.constructor.name : e.name;
  if (e instanceof ApiError || e instanceof LlmApiError) return name.replace(/Error$/, 'Exception');
  return name;
}

function errorText(e: unknown): string {
  return `${javaSimpleName(e)}: ${e instanceof Error ? e.message : String(e)}`;
}

export interface EngineParts {
  db: Database;
  storage: ObjectStorage;
  log: Logger;
  now: Now;
  router: KbLlmRouter;
  batch: BatchLlmExecutor;
  submitter: KbBatchSubmitter;
  sync: SyncLlmExecutor;
  usage: KbUsageRecorder;
  settings: () => KbSettingsPort;
  costs: KbCostService;
  requestStore: KbRunRequestStore;
  /** kb.pipeline.background: kicks advance runs in the background (off in tests). */
  background: boolean;
}

export class KbRunEngine {
  static readonly ACTIVE = ACTIVE;
  static readonly MOVING = MOVING;

  private readonly handlers: KbRunHandler[] = [];
  /** Per run: "advance again" requests that arrived while it was advancing. */
  private readonly again = new Map<string, { value: boolean }>();
  /** Runs paused on the daily token quota -> when to try again (in memory). */
  private readonly quotaPausedUntil = new Map<string, Odt>();
  private readonly stepFailures = new Map<string, StepFailure>();
  private readonly recordLock = new Mutex();
  /** Background advances in flight, and every running advance (idle() and stop() await both). */
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly advancing = new Set<Promise<unknown>>();
  /** Leases this engine holds, per run. */
  private readonly leases = new Map<string, HeldLease>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;

  constructor(private readonly p: EngineParts) {}

  private get db(): Database {
    return this.p.db;
  }

  private get log(): Logger {
    return this.p.log;
  }

  private now(): Odt {
    return this.p.now();
  }

  /** Adds a kind of run (the pipeline registers itself; evaluations register theirs). */
  register(handler: KbRunHandler): void {
    if (!this.handlers.includes(handler)) this.handlers.push(handler);
  }

  // ==== driving runs ============================================================

  /** Advances every active run, one after another (tests and the sweep's fallback). */
  async advanceActive(): Promise<void> {
    for (const id of await this.activeRunIds()) await this.advance(id);
  }

  /**
   * Startup resume of an active run (KbPipelineJob.onStartup). False when the run must not be
   * resumed. A RUNNING run counts one resume only when it is still leased: whoever advanced it
   * never released it, so that process died (or, in a blue/green deploy, is still running; its
   * release then undoes this count, see releaseLease). A run with no lease was not being advanced,
   * or its advancer stopped cleanly: not counted. Past MAX_RESUMES inside RESUME_WINDOW without a
   * stage finishing the run is failed: here when the lease already expired, else when the lease is
   * taken over (takeFreshLease), since a live lease may belong to a process that is still running.
   */
  registerResume(runId: string): Promise<boolean> {
    return inTx(this.db, async () => {
      const run = await runs.lockById(runId);
      if (run == null || !run.isActive()) return false;
      if (run.status !== 'RUNNING') return true;
      const lease = (await runs.leaseState(runId, this.now()))!;
      if (lease.owner == null) {
        this.log.info(`KB run ${runId} resumed after a restart (it was not being advanced or stopped cleanly: not counted)`);
        return true;
      }
      await runs.countResume(runId, this.now(), this.now().plusMinutes(-RESUME_WINDOW_MIN));
      const n = await runs.resumeCount(runId);
      if (n <= MAX_RESUMES) {
        this.log.warn(`KB run ${runId} resumed after a restart (${n} of ${MAX_RESUMES} allowed within PT30M)`);
        return true;
      }
      if (lease.live) {
        this.log.warn(`KB run ${runId}: ${n} startups in PT30M; its lease is still held, decided when it is taken over`);
        return true;
      }
      await this.failResumeLoop(run, n);
      return false;
    });
  }

  /** The restart-loop guard's verdict, inside the caller's transaction (the run row locked). */
  private async failResumeLoop(run: KbRun, n: number): Promise<void> {
    this.log.error(`KB run ${run.id} failed: ${n} startups in PT30M without finishing ${run.stage} stage`);
    run.error = `${RESUME_LOOP_ERROR} (${run.stage})`;
    for (const s of await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.id)) {
      if (s.isActive()) s.fail(RESUME_LOOP_ERROR);
    }
    run.finish('FAILED', this.now());
  }

  activeRunIds(): Promise<string[]> {
    return inTx(this.db, async () => (await runs.findByStatusIn(ACTIVE)).map((r) => r.id));
  }

  /**
   * Advances one run as far as it can go now. One advancer per run: a DB lease
   * renewed every minute; a call that finds the run busy only asks the holder to
   * loop once more. False when another advancer holds the run (or the engine is stopping).
   */
  advance(runId: string): Promise<boolean> {
    const p = this.advanceOnce(runId);
    this.advancing.add(p);
    void p.finally(() => this.advancing.delete(p)).catch(() => {});
    return p;
  }

  private async advanceOnce(runId: string): Promise<boolean> {
    if (this.stopped) return false;
    let flag = this.again.get(runId);
    if (!flag) this.again.set(runId, (flag = { value: false }));
    flag.value = true;
    const token = crypto.randomUUID();
    const kept = await this.takeFreshLease(runId, token);
    if (kept === 'busy') return false;
    if (kept === 'failed') return true;
    const heartbeat = setInterval(() => {
      this.takeLease(runId, token).catch(() => {});
    }, LEASE_RENEW_MS);
    heartbeat.unref?.();
    const held: HeldLease = { token, heartbeat, kept };
    this.leases.set(runId, held);
    try {
      while (flag.value && !this.stopped) {
        flag.value = false;
        for (let i = 0; i < MAX_STEPS && !this.stopped && (await this.step(runId)); i++) {
          // keep going
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (this.leases.get(runId) === held) this.leases.delete(runId);
      await inTx(this.db, () => runs.releaseLease(runId, token, held.kept));
    }
    if (this.stopped) return true;
    if (flag.value) return this.advance(runId); // a kick arrived while releasing
    if (this.again.get(runId) === flag) this.again.delete(runId);
    return true;
  }

  /**
   * Takes a free or expired lease, remembering the resume counter as it is now (the release
   * restores it). Taking over a run that startups resumed more than MAX_RESUMES times (their
   * previous holders died, see registerResume) fails it instead: 'failed', lease released.
   */
  private takeFreshLease(runId: string, token: string): Promise<ResumeCounter | 'busy' | 'failed'> {
    const now = this.now();
    return inTx(this.db, async () => {
      if ((await runs.takeLease(runId, token, now.plusSeconds(LEASE_MS / 1000), now)) !== 1) return 'busy';
      const lease = (await runs.leaseState(runId, now))!;
      if (lease.count > MAX_RESUMES) {
        const run = await runs.lockById(runId);
        if (run != null && run.isActive()) {
          await this.failResumeLoop(run, lease.count);
          await runs.releaseLease(runId, token);
          return 'failed';
        }
      }
      return { count: lease.count, windowStart: lease.windowStart };
    });
  }

  private async takeLease(runId: string, token: string): Promise<boolean> {
    const now = this.now();
    return (await inTx(this.db, () => runs.takeLease(runId, token, now.plusSeconds(LEASE_MS / 1000), now))) === 1;
  }

  /** One transition; false when the run has to wait (or is over/blocked). */
  async step(runId: string): Promise<boolean> {
    const before = await inTx(this.db, async () => {
      const r = await runs.findById(runId);
      return r == null ? null : { stage: r.stage, status: r.status };
    });
    const moved = await this.stepOnce(runId);
    if (before != null) await this.transitions(runId, before.stage ?? '', before.status);
    return moved;
  }

  private async transitions(runId: string, stageBefore: string, statusBefore: string): Promise<void> {
    await inTx(this.db, async () => {
      const r = await runs.findById(runId);
      if (r == null) return;
      const stageChanged = r.stage !== stageBefore;
      const ended = !r.isActive() && statusBefore !== r.status;
      if (!stageChanged && !ended) return;
      if (stageChanged) {
        await runs.resetResumes(runId);
        const held = this.leases.get(runId);
        if (held) held.kept = { count: 0, windowStart: null };
      }
      const at = this.now().toString();
      const logNode = (isObject(r.stageLog) ? deepCopy(r.stageLog) : {}) as JsonObject;
      if (!isObject(logNode[stageBefore])) logNode[stageBefore] = {};
      const prev = logNode[stageBefore] as JsonObject;
      if (!('startedAt' in prev)) prev.startedAt = r.startedAt == null ? at : r.startedAt.toString();
      prev.finishedAt = at;
      if (stageChanged && r.stage !== 'DONE') {
        if (!isObject(logNode[r.stage!])) logNode[r.stage!] = {};
        (logNode[r.stage!] as JsonObject).startedAt = at;
      }
      r.stageLog = logNode;
      const total = await requests.countByRunIdAndStage(runId, stageBefore);
      const done = await requests.countByRunIdAndStageAndStatus(runId, stageBefore, 'DONE');
      const failed = await requests.countByRunIdAndStageAndStatus(runId, stageBefore, 'FAILED');
      this.log.info(`KB ${r.isEval() ? 'eval' : 'run'} ${runId} ${stageBefore}: ${stageBefore} -> ${r.stage} (${r.status}; ${total} requests: ${done} done, ${failed} failed)`);
    });
  }

  private async stepOnce(runId: string): Promise<boolean> {
    const run = await inTx(this.db, () => runs.findById(runId));
    if (run == null || !run.isActive() || run.status === 'BLOCKED_BY_COST_LIMIT') {
      this.stepFailures.delete(runId);
      return false;
    }
    const failure = this.stepFailures.get(runId);
    if (failure && failure.stage === run.stage && this.now().isBefore(failure.nextAt)) return false;
    const moved = await this.stepGuarded(runId, run);
    if (this.stepFailures.get(runId) === failure) this.stepFailures.delete(runId); // no new failure: a clean step
    return moved;
  }

  private async stepGuarded(runId: string, run: KbRun): Promise<boolean> {
    const handler = this.handler(run);
    const stage = run.stage ?? '';
    try {
      if (stage === 'DETECT') return await this.whileActive(runId, (r) => handler.detect(r));
      if (LLM_STAGES.includes(stage)) return await this.llmStage(runId, stage, run.dryRun, handler);
      if (stage === 'DONE') return false;
      await handler.complete(runId);
      return true;
    } catch (e) {
      if (e instanceof LlmApiError) {
        // The provider is unreachable or refusing: try again on the next poll.
        this.log.warn(`KB run ${runId} at ${stage}: ${e.message}`);
        await inTx(this.db, async () => {
          const r = await runs.findById(runId);
          if (r) r.error = 'LLM API: ' + e.message;
        });
        return false;
      }
      const prev = this.stepFailures.get(runId);
      const n = prev != null && prev.stage === stage ? prev.count + 1 : 1;
      const reason = errorText(e);
      if (n < MAX_STEP_FAILURES) {
        const waitMin = 1 << (n - 1);
        this.log.warn({ err: e }, `KB run ${runId} step ${stage} failed (${n} of ${MAX_STEP_FAILURES}); retrying in PT${waitMin}M`);
        this.stepFailures.set(runId, { stage, count: n, nextAt: this.now().plusMinutes(waitMin) });
        try {
          await inTx(this.db, async () => {
            const r = await runs.findById(runId);
            if (r) r.error = `step ${r.stage} failed (${n}/${MAX_STEP_FAILURES}), will retry: ${reason}`;
          });
        } catch (e2) {
          this.log.warn(`KB run ${runId}: could not record the step failure: ${(e2 as Error).message}`);
        }
        return false;
      }
      this.stepFailures.delete(runId);
      this.log.error({ err: e }, `KB run ${runId} failed at ${stage} after ${n} attempts`);
      await inTx(this.db, async () => {
        const r = await runs.lockById(runId);
        if (r == null || !r.isActive()) return;
        r.error = `${reason} (${r.stage}, ${n} attempts)`;
        for (const s of await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId)) {
          if (s.isActive()) s.fail('run failed at ' + r.stage);
        }
        r.finish('FAILED', this.now());
      });
      return false;
    }
  }

  async cancel(runId: string): Promise<KbRun> {
    const run = await inTx(this.db, () => runs.findById(runId));
    if (run == null) throw new ResourceNotFoundError('KbRun', runId);
    if (!run.isActive()) throw new KbPipelineError('RUN_NOT_ACTIVE', 'The run is not active');
    for (const j of await inTx(this.db, () => jobs.findByRunIdOrderByCreatedAtAsc(runId))) {
      if (j.status !== 'SUBMITTED' || j.doBatchId == null) continue;
      try {
        await this.p.batch.cancel(j.doBatchId);
      } catch (e) {
        if (!(e instanceof LlmApiError)) throw e;
        this.log.warn(`KB run ${runId}: cancelling batch ${j.doBatchId} failed: ${e.message}`);
      }
    }
    // Row-locked: a stage finishing or a subject publishing right now completes
    // first, and whatever comes after sees CANCELLED.
    return inTx(this.db, async () => {
      const r = (await runs.lockById(runId))!;
      if (!r.isActive()) return r;
      for (const j of await jobs.findByRunIdOrderByCreatedAtAsc(runId)) {
        if (j.status === 'SUBMITTED' || j.status === 'QUEUED') j.status = 'CANCELLED';
      }
      for (const s of await runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId)) {
        if (s.isActive()) s.status = 'CANCELLED';
      }
      r.finish('CANCELLED', this.now());
      return r;
    });
  }

  /** Staff accept a run blocked by the weekly cost limit (once). */
  approveCost(runId: string): Promise<KbRun> {
    return inTx(this.db, async () => {
      const r = await runs.lockById(runId);
      if (r == null) throw new ResourceNotFoundError('KbRun', runId);
      if (r.status !== 'BLOCKED_BY_COST_LIMIT') {
        throw new KbPipelineError('RUN_NOT_BLOCKED', 'The run is not blocked by the cost limit');
      }
      r.costApproved = true;
      r.status = 'RUNNING';
      r.error = null;
      return r;
    });
  }

  // ==== stages =====================================================================

  private async llmStage(runId: string, stage: string, dry: boolean, handler: KbRunHandler): Promise<boolean> {
    const stageJobs = await inTx(this.db, () => jobs.findByRunIdAndStage(runId, stage));
    if (stageJobs.length === 0) {
      const pending = await inTx(this.db, () => requests.countByRunIdAndStageAndStatusIn(runId, stage, ['PENDING']));
      if (pending === 0) {
        const built = await inTx(this.db, async () => {
          const r = (await runs.lockById(runId))!;
          return r.isActive() ? handler.build(r, stage, new Seq(await requests.countByRunId(runId))) : -1;
        });
        if (built < 0) return false;
        if (built === 0) return this.whileActive(runId, (r) => handler.after(r, stage));
      }
      if (!dry && (handler.costLimited?.() ?? true) && (await this.blockedByCost(runId, stage, null))) return false;
      await this.submit(runId, stage, 1, dry);
      return true;
    }
    const open = stageJobs.filter((j) => j.status === 'SUBMITTED' || j.status === 'QUEUED');
    if (open.length > 0) {
      let allDone = true;
      // Sync jobs (one per model) resume together, sharing the concurrency.
      const openSync = open.filter((j) => j.mode === 'SYNC' && j.status === 'SUBMITTED').map((j) => j.id!);
      if (openSync.length > 0 && ((await this.quotaPaused(runId)) || (await this.runSyncJobs(openSync)))) allDone = false;
      for (const job of open) {
        if (job.mode === 'SYNC') continue;
        if (job.status === 'QUEUED') {
          // Created before DO was called; a refused creation waits for nextAttemptAt.
          const outcome = await this.p.submitter.submitQueued(job.id!);
          if (outcome !== 'FAILED') allDone = false;
          continue;
        }
        const info = await this.p.batch.poll(job.doBatchId!);
        await this.observe(job.id!, info);
        if (info.finished()) await this.collectBatch(job.id!, info);
        else allDone = false;
      }
      if (!allDone) {
        await inTx(this.db, () => runs.setStatusIf(runId, 'WAITING', MOVING));
        return false;
      }
      return true;
    }
    if (dry) return this.whileActive(runId, (r) => handler.after(r, stage));
    const maxAttempt = stageJobs.reduce((m, j) => Math.max(m, j.attempt), 1);
    const syncJobs = new Set(stageJobs.filter((j) => j.mode === 'SYNC').map((j) => j.id));
    const leftover = await inTx(this.db, async () => {
      const ids: string[] = [];
      await this.forPages(await requests.idsByRunStageStatus(runId, stage, ['SUBMITTED', 'PENDING']), async (rows) => {
        for (const r of rows) {
          // Sync already retried empty/truncated answers with double max_tokens.
          if (syncJobs.has(r.batchJobId) && emptyOrTruncated(r.error)) {
            r.failed(r.error!);
            continue;
          }
          ids.push(r.customId);
        }
      });
      // Answered but unusable (e.g. a PLAN whose operations were all dropped): sent
      // once more with the second attempt.
      if (maxAttempt < 2) {
        const r = await runs.findById(runId);
        if (r != null && r.isActive() && handler.redo) ids.push(...(await handler.redo(r, stage)));
      }
      return ids;
    });
    if (leftover.length > 0 && maxAttempt < 2) {
      if ((handler.costLimited?.() ?? true) && (await this.blockedByCost(runId, stage, leftover))) return false;
      await inTx(this.db, () => this.forPages(leftover, async (rows) => {
        for (const r of rows) {
          if (emptyOrTruncated(r.error)) r.doubleMaxTokens(MAX_TOKENS_CAP);
          r.status = 'PENDING';
        }
      }));
      await this.submit(runId, stage, maxAttempt + 1, false);
      return true;
    }
    return this.whileActive(runId, async (r) => {
      await this.forPages(leftover, async (rows) => {
        for (const q of rows) q.failed(q.error == null ? 'no answer after resubmission' : q.error);
      });
      await handler.after(r, stage);
    });
  }

  /** Walks requests by custom id, PAGE rows at a time (flushed and detached). Inside a transaction. */
  async forPages(ids: string[], work: (rows: KbRunRequest[]) => Promise<void>): Promise<void> {
    for (let i = 0; i < ids.length; i += PAGE) {
      const rows = await requests.findAllById(ids.slice(i, Math.min(ids.length, i + PAGE)));
      await work(rows);
      await requests.detach(rows);
    }
  }

  /** Runs `work` on the row-locked run if it is still active; false when it is not. */
  private whileActive(runId: string, work: (r: KbRun) => Promise<void>): Promise<boolean> {
    return inTx(this.db, async () => {
      const r = await runs.lockById(runId);
      if (r == null || !r.isActive()) return false;
      await work(r);
      return true;
    });
  }

  /**
   * Weekly cost limit, checked before every submission: everything recorded in
   * kb_llm_usage over the last 7 days plus the estimate of the requests about to go
   * out (`only`: those custom ids, else the stage's PENDING ones).
   */
  private async blockedByCost(runId: string, stage: string, only: string[] | null): Promise<boolean> {
    const limit = (await this.p.settings().effective()).weeklyCostLimitUsd;
    if (limit == null) return false;
    return inTx(this.db, async () => {
      const run = (await runs.lockById(runId))!;
      if (run.costApproved || !run.isActive()) return false;
      const mode = (await this.p.settings().effective()).executionMode;
      const spent = await this.p.costs.spentSince(this.now().plusHours(-7 * 24));
      let estimate = Dec.ZERO;
      const perModel: [string, number, number][] = [];
      if (only == null) perModel.push(...(await requests.pendingEstimate(runId, stage)));
      else for (let i = 0; i < only.length; i += 1000) perModel.push(...(await requests.estimateOf(only.slice(i, i + 1000))));
      for (const [model, est, max] of perModel) {
        estimate = estimate.add(await this.p.costs.estimate(model, await this.p.router.modeFor(model, mode), est, max));
      }
      const total = spent.add(estimate);
      if (total.compareTo(limit) <= 0) return false;
      run.status = 'BLOCKED_BY_COST_LIMIT';
      run.error = `Spent in the last 7 days US$${spent.setScale(2, 'HALF_UP').toString()} + estimated US$${estimate.setScale(2, 'HALF_UP').toString()} for ${stage} exceeds the weekly limit US$${limit.toString()}; approve with approve-cost`;
      this.log.warn(`KB run ${runId} blocked by the weekly cost limit at ${stage} (${spent.toString()} + ${estimate.toString()} > ${limit.toString()})`);
      return true;
    });
  }

  /** Stores the canonical JSONL of the stage's PENDING requests (one per model) and, unless dry, executes them. */
  private async submit(runId: string, stage: string, attempt: number, dry: boolean): Promise<void> {
    const executionMode = (await this.p.settings().effective()).executionMode;
    const byModel = await inTx(this.db, async () => {
      const m = new Map<string, string[]>();
      for (const [id, model] of await requests.pendingIdsAndModels(runId, stage)) {
        let l = m.get(model);
        if (!l) m.set(model, (l = []));
        l.push(id);
      }
      return m;
    });
    let n = 0;
    const syncJobs: string[] = [];
    for (const [model, ids] of byModel) {
      n++;
      const mode = await this.p.router.modeFor(model, executionMode);
      const base = `kb/runs/${runId}/${stage.toLowerCase()}${attempt > 1 ? '-' + attempt : ''}${byModel.size > 1 ? '-' + n : ''}`;
      if (!dry && mode === 'BATCH') {
        // At most KB_BATCH_MAX_REQUESTS per batch file: a bigger stage is several jobs (parts).
        const parts = split(ids, this.p.settings().batchMaxRequests());
        let part = 0;
        for (const chunk of parts) {
          part++;
          const key = base + (parts.length > 1 ? '-p' + part : '') + '.jsonl';
          await this.storeJsonl(key, chunk);
          const queued = await this.p.submitter.queue(runId, stage, attempt, model, part, chunk, key);
          if (queued != null) await this.p.submitter.submitQueued(queued.id!);
        }
        continue;
      }
      const key = base + '.jsonl';
      await this.storeJsonl(key, ids);
      const job = await inTx(this.db, () => jobs.save(new KbBatchJob(runId, stage, attempt, model, mode, ids.length, key)));
      if (dry) continue;
      await inTx(this.db, async () => (await jobs.findById(job.id!))!.submitted(null, null, this.now()));
      for (let i = 0; i < ids.length; i += PAGE) {
        const page = ids.slice(i, i + PAGE);
        await inTx(this.db, () => requests.markSubmitted(job.id!, page));
      }
      syncJobs.push(job.id!);
    }
    // Every model's sync job of the stage runs at once (one shared pool).
    if (syncJobs.length > 0) await this.runSyncJobs(syncJobs);
  }

  /** The canonical JSONL of these requests (in id order), read JSONL_PAGE per transaction. */
  private async storeJsonl(key: string, ids: string[]): Promise<void> {
    const parts: string[] = [];
    for (let i = 0; i < ids.length; i += JSONL_PAGE) {
      const page = ids.slice(i, i + JSONL_PAGE);
      parts.push(await inTx(this.db, async () => {
        const byId = new Map<string, KbRunRequest>();
        for (const r of await requests.findAllById(page)) byId.set(r.customId, r);
        let sb = '';
        for (const id of page) {
          const r = byId.get(id);
          if (!r) continue;
          sb += nodeToString({ custom_id: id, params: r.params }) + '\n';
        }
        return sb;
      }));
    }
    await this.p.storage.put(key, 'application/x-ndjson', new TextEncoder().encode(parts.join('')));
  }

  /**
   * SYNC: executes the jobs' unanswered requests in one pool; each answer is recorded
   * as it arrives. True when the pool paused on DO's daily token quota (the
   * unanswered requests stay SUBMITTED, their jobs open, the runs WAITING).
   */
  private async runSyncJobs(jobIds: string[]): Promise<boolean> {
    const byId = new Map<string, KbBatchJob>();
    const jobOf = new Map<string, string>();
    const todo: string[] = [];
    const pendingCount = new Map<string, number>();
    await inTx(this.db, async () => {
      for (const id of jobIds) {
        byId.set(id, (await jobs.findById(id))!);
        const ids = await requests.unansweredIdsOfJob(id);
        for (const c of ids) jobOf.set(c, id);
        todo.push(...ids);
        pendingCount.set(id, ids.length);
      }
    });
    const outputs = new Map<string, string[]>();
    const runIds = [...new Set([...byId.values()].map((j) => j.runId))];
    const lines = pagedLines(todo, Math.max(10, this.p.sync.concurrency() * 2), txRunner(this.db), this.p.requestStore);
    const paused = await this.p.sync.run(lines, async (outcome: SyncOutcome) => {
      const result = outcome.result;
      const job = byId.get(jobOf.get(result.customId)!)!;
      await this.recordLock.run(async () => {
        await this.recordOne(job, 'SYNC', result, outcome);
        try {
          let out = outputs.get(job.id!);
          if (!out) outputs.set(job.id!, (out = []));
          out.push(nodeToString(this.outputLine(result)));
        } catch (e) {
          this.log.warn(`KB run ${job.runId}: audit line of ${result.customId} not written: ${(e as Error).message}`);
        }
      });
    }, this.cancelCheck(runIds));
    const pausedRuns = new Set<string>();
    // Stopped by a shutdown: like the quota pause, the unanswered requests stay SUBMITTED and
    // their jobs open, so the next process resumes them (no resubmission attempt is spent).
    const interrupted = paused || this.stopped;
    for (const job of byId.values()) {
      const out = outputs.get(job.id!);
      const unanswered = interrupted && (await inTx(this.db, () => requests.countUnansweredOfJob(job.id!))) > 0;
      let outKey: string | null = null;
      if (out && out.length > 0) {
        outKey = job.payloadKey!.replace('.jsonl', '-out'
          + (unanswered ? '-partial-' + this.now().epochSecond
            : pendingCount.get(job.id!)! < job.requestCount ? '-resumed' : '') + '.jsonl');
        await this.putAudit(outKey, out.map((l) => l + '\n').join(''));
      }
      if (unanswered) {
        if (paused) pausedRuns.add(job.runId);
        continue;
      }
      const key = outKey;
      await inTx(this.db, async () => {
        const j = (await jobs.findById(job.id!))!;
        if (j.status === 'SUBMITTED') j.finish('COMPLETED', key, this.now(), null);
      });
      this.log.info(`KB run ${job.runId} ${job.stage} sync job done (${pendingCount.get(job.id!)} requests, ${job.model})`);
    }
    for (const runId of runIds) {
      if (!pausedRuns.has(runId)) await inTx(this.db, () => runs.setStatusIf(runId, 'RUNNING', MOVING));
    }
    for (const runId of pausedRuns) await this.pauseForQuota(runId);
    return pausedRuns.size > 0;
  }

  /** Daily token quota spent: no reply until pausedUntil. */
  private async pauseForQuota(runId: string): Promise<void> {
    const until = this.now().plusSeconds(DAILY_RETRY_SEC);
    this.quotaPausedUntil.set(runId, until);
    const reason = QUOTA_PAUSE + formatHHmm(until, ART_ZONE);
    await inTx(this.db, async () => {
      await runs.setStatusIf(runId, 'WAITING', MOVING);
      const r = await runs.findById(runId);
      if (r != null && r.isActive()) r.error = reason;
    });
    this.log.warn(`KB run ${runId} paused: ${reason}`);
  }

  /** True while the run's quota pause has not elapsed; once it has, the pause and its reason are cleared. */
  private async quotaPaused(runId: string): Promise<boolean> {
    const until = this.quotaPausedUntil.get(runId);
    if (until == null) return false;
    if (this.now().isBefore(until)) return true;
    if (this.quotaPausedUntil.get(runId) === until) this.quotaPausedUntil.delete(runId);
    await inTx(this.db, async () => {
      const r = await runs.findById(runId);
      if (r != null && r.error != null && r.error.startsWith(QUOTA_PAUSE_PREFIX)) r.error = null;
    });
    return false;
  }

  /** Runs whose quota pause is over (the batch poller kicks them). */
  quotaResumeDue(): string[] {
    const now = this.now();
    return [...this.quotaPausedUntil.entries()].filter(([, at]) => !now.isBefore(at)).map(([id]) => id);
  }

  /** Whether every run of a sync pool was cancelled, read from the DB at most every few seconds. */
  private cancelCheck(runIds: string[]): () => boolean {
    let stopped = false;
    let checkedAt = performance.now() - CANCEL_CHECK_MS;
    let checking = false;
    return () => {
      if (this.stopped) return true; // shutdown: in-flight requests finish, no new ones start
      const t = performance.now();
      if (!stopped && !checking && t - checkedAt >= CANCEL_CHECK_MS) {
        checkedAt = t;
        checking = true;
        // Read asynchronously; the answer applies from the next request on.
        void (async () => {
          try {
            let anyActive = false;
            for (const id of runIds) {
              const r = await outsideTx(() => inTx(this.db, () => runs.findById(id)));
              if (r != null && r.isActive()) anyActive = true;
            }
            stopped = !anyActive;
          } catch {
            // keep going
          } finally {
            checking = false;
          }
        })();
      }
      return stopped;
    };
  }

  private outputLine(r: LlmResult): JsonObject {
    const o: JsonObject = { custom_id: r.customId, ok: r.ok, path: r.path };
    if (r.toolInput != null) o.result = r.toolInput;
    else if (r.text != null) o.text = r.text;
    if (r.error != null) o.error = r.error;
    o.usage = { input_tokens: r.tokensIn, cached_input_tokens: r.cachedTokens, output_tokens: r.tokensOut };
    return o;
  }

  /** BATCH: a finished batch, recorded, then its audit copy stored (best effort). */
  private async collectBatch(jobId: string, info: BatchInfo): Promise<void> {
    const job = (await inTx(this.db, () => jobs.findById(jobId)))!;
    const files = await this.p.batch.collect(job.doBatchId!, info.status === 'completed');
    const key = files.output == null ? null : job.payloadKey!.replace('.jsonl', '-out.jsonl');
    const status = info.status === 'completed' ? 'COMPLETED' : info.status === 'cancelled' ? 'CANCELLED' : 'FAILED';
    const error = status === 'COMPLETED' ? null : batchError(info);
    const errorLines = parseOutput(files.errors);
    const outputLines = parseOutput(files.output);
    const hasResults = errorLines.size > 0 || outputLines.size > 0;
    // A batch refused as a whole (e.g. DO's JSONL model validation) is not resubmitted.
    const permanent = status === 'FAILED' && info.errorMessage != null
      && classifyFailure(info.errorMessage) !== 'RATE_LIMITED' && !hasResults;
    await this.recordResults(job, [...errorLines.values()]);
    await this.recordResults(job, [...outputLines.values()]); // the output wins over the error file
    await inTx(this.db, async () => {
      const run = (await runs.lockById(job.runId))!; // first: same lock order as cancel
      if (error != null) {
        await this.forPages(await requests.unansweredIdsOfJob(jobId), async (rows) => {
          for (const r of rows) {
            if (permanent) r.failed(error);
            else r.error = error;
          }
        });
      }
      (await jobs.findById(jobId))!.finish(status, key, this.now(), error);
      if (run.isActive()) {
        run.status = 'RUNNING';
        if (permanent) run.error = `${error} (${job.stage}, ${job.model})`;
      }
    });
    if (key != null) await this.putAuditBytes(key, files.output!);
    if (files.errors != null) await this.putAuditBytes(job.payloadKey!.replace('.jsonl', '-err.jsonl'), files.errors);
    this.log.info(`KB run ${job.runId} ${job.stage} batch ${info.id} ${info.status}${error == null ? '' : ': ' + error}`);
  }

  private async recordResults(job: KbBatchJob, results: LlmResult[]): Promise<void> {
    for (let i = 0; i < results.length; i += RECORD_PAGE) await this.recordPage(job, results.slice(i, i + RECORD_PAGE));
  }

  private async recordPage(job: KbBatchJob, page: LlmResult[]): Promise<void> {
    if (page.length === 0) return;
    try {
      await inTx(this.db, async () => {
        await runs.lockById(job.runId); // first: same lock order as cancel
        for (const res of page) await this.record(job.runId, job.id!, 'BATCH', res, null);
      });
    } catch (e) {
      // One bad row must not fail the job: the page is recorded again answer by answer.
      this.log.warn(`KB run ${job.runId}: recording a page of answers failed (${(e as Error).message}); recording one by one`);
      for (const res of page) await this.recordOne(job, 'BATCH', res, null);
    }
  }

  /** One answer in its own transaction; if it cannot be stored, only that request fails. */
  private async recordOne(job: KbBatchJob, mode: string, res: LlmResult, outcome: SyncOutcome | null): Promise<void> {
    try {
      await inTx(this.db, async () => {
        await runs.lockById(job.runId);
        await this.record(job.runId, job.id!, mode, res, outcome);
      });
    } catch (e) {
      this.log.warn(`KB run ${job.runId}: answer ${res.customId} could not be stored: ${(e as Error).message}`);
      try {
        const why = 'could not store the answer: ' + javaSimpleName(e);
        await inTx(this.db, async () => {
          const r = await requests.findById(res.customId);
          if (r) r.failed(why);
        });
      } catch (e2) {
        this.log.warn(`KB run ${job.runId}: request ${res.customId} could not be marked failed: ${(e2 as Error).message}`);
      }
    }
  }

  /** Stores an audit copy without reasoning_content (never raises: results are already recorded). */
  private async putAudit(key: string, text: string): Promise<void> {
    try {
      let out = '';
      for (let line of text.split('\n')) {
        if (line.trim() === '') continue;
        if (line.includes('reasoning_content')) {
          try {
            const node = readTree(line);
            stripReasoning(node);
            line = nodeToString(node);
          } catch {
            // keep the line as it came
          }
        }
        out += line + '\n';
      }
      await this.p.storage.put(key, 'application/x-ndjson', new TextEncoder().encode(out));
    } catch (e) {
      this.log.warn(`KB: storing the audit copy ${key} failed (results are recorded): ${(e as Error).message}`);
    }
  }

  private putAuditBytes(key: string, bytes: Uint8Array): Promise<void> {
    return this.putAudit(key, new TextDecoder().decode(bytes));
  }

  /** Keeps DO's status and request_counts of a polled batch (progress). */
  private async observe(jobId: string, info: BatchInfo): Promise<void> {
    let counts: JsonValue | undefined;
    try {
      if (info.raw != null) counts = path(readTree(info.raw), 'request_counts');
    } catch {
      // no counts
    }
    await inTx(this.db, async () => {
      const j = await jobs.findById(jobId);
      if (j) j.observed(info.status, counts, this.now());
    });
  }

  /** One answer: request row, usage (frozen cost), job/run/subject totals. */
  private async record(runId: string, jobId: string, mode: string, res: LlmResult, outcome: SyncOutcome | null): Promise<void> {
    const run = (await runs.lockById(runId))!;
    const r = await requests.findById(res.customId);
    if (r == null || r.status === 'DONE') return;
    if (r.batchJobId != null && r.batchJobId !== jobId) return; // an older job's late answer
    r.answered(this.now(), outcome == null ? null : outcome.latencyMs);
    const handler = this.handler(run);
    if (res.ok) {
      const p = emptyOrTruncated(r.error) && res.path != null && !res.path.endsWith('+retry') ? res.path + '+retry' : res.path;
      r.done(res.toolInput != null ? res.toolInput : res.text, res.tokensIn, res.tokensOut, res.cachedTokens, p);
    } else {
      r.error = res.error;
    }
    const paid = res.tokensIn > 0 || res.tokensOut > 0
      || (outcome != null && outcome.attempts.some((a) => a.tokensIn > 0 || a.tokensOut > 0));
    if (!paid) return;
    const stage = handler.usageStage ? handler.usageStage(r.stage) : r.stage;
    let cost = Dec.ZERO;
    const usageRun = run.isEval() ? null : runId;
    const usageEval = run.isEval() ? runId : null;
    if (outcome != null && outcome.attempts.length > 0) {
      let n = 0;
      for (const a of outcome.attempts) {
        n++;
        cost = cost.add(await this.p.usage.record(usageRun, usageEval, r.customId, r.model, mode, stage, r.subjectId,
          a.tokensIn, a.cachedTokens, a.tokensOut, n, a.latencyMs, a.reasoningTokens));
      }
    } else {
      const attempt = (await jobs.findById(jobId))?.attempt ?? 1;
      cost = await this.p.usage.record(usageRun, usageEval, r.customId, r.model, mode, stage, r.subjectId,
        res.tokensIn, res.cachedTokens, res.tokensOut, attempt, null, null);
    }
    const total = cost;
    (await jobs.findById(jobId))?.addUsage(res.tokensIn, res.tokensOut, res.cachedTokens, total);
    run.addTokens(res.tokensIn, res.tokensOut);
    run.addCached(res.cachedTokens);
    run.addCost(total);
    if (this.p.router.simulated()) run.simulated = true;
    (await runSubjects.findById(runId, r.subjectId))?.addUsage(res.tokensIn, res.tokensOut, res.cachedTokens, total);
  }

  // ==== helpers for handlers ========================================================

  request(run: KbRun, subjectId: string, stage: string, target: string, chunk: number, model: string, params: JsonValue,
    seq: Seq): KbRunRequest {
    const customId = `${run.id.substring(0, 8)}-${stage.charAt(0)}-${String(seq.next()).padStart(6, '0')}`;
    const itemKey = `${run.id}:${stage}:${subjectId}:${target}:${chunk}`;
    return new KbRunRequest(customId, run.id, stage, subjectId, itemKey, target, chunk, model, params, estimateTokens(params));
  }

  private handler(run: KbRun): KbRunHandler {
    const h = this.handlers.find((x) => x.handles(run));
    if (!h) throw new Error(`No handler for run ${run.id}`);
    return h;
  }

  // ==== background (scheduling/KbPipelineJob.kick) ======================================

  /**
   * RunTriggered: a run/eval created, approved or resumed is advanced at once in the
   * background (no-op with kb.pipeline.background=false: tests drive the engine).
   */
  triggered(runId: string): void {
    this.kick(runId);
  }

  /**
   * Advances one run in the background. When another advancer holds the lease, try
   * again once that lease can have expired instead of waiting for the sweep.
   */
  kick(runId: string): void {
    // KbPipelineJob (the kicker) only exists with kb.pipeline.background=true.
    if (this.stopped || !this.p.background) return;
    const task = outsideTx(() => (async () => {
      await Promise.resolve();
      try {
        if (!(await this.advance(runId)) && !this.stopped) {
          const t = setTimeout(() => {
            this.timers.delete(t);
            this.kick(runId);
          }, LEASE_MS + 5_000);
          t.unref?.();
          this.timers.add(t);
        }
      } catch (e) {
        this.log.warn(`KB run ${runId} could not be advanced now (the sweep retries): ${(e as Error).message}`);
      }
    })());
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  /** Resolves once no advance is running (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0 || this.advancing.size > 0) {
      await Promise.allSettled([...this.inFlight, ...this.advancing]);
    }
  }

  /**
   * Shutdown, first phase ('closing', on SIGTERM): no new advances or retries; running advances
   * stop after their current step, and a sync pool starts no new request (in-flight ones finish
   * and are recorded).
   */
  beginStop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * Shutdown, last phase ('executors'): waits up to `waitMs` for running advances, which release
   * their leases (undoing resumes counted meanwhile, see releaseLease). Leases still held after
   * that (a sync request slower than the wait) are released anyway, so the next process takes the
   * run over at once and does not count the stop as a crash; the answers of those requests are lost
   * (they stay SUBMITTED and are sent again by the next process).
   */
  async stop(waitMs = STOP_WAIT_MS): Promise<void> {
    this.beginStop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      this.idle().then(() => false),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(true), waitMs); }),
    ]);
    clearTimeout(timer);
    if (!timedOut) return;
    for (const [runId, held] of [...this.leases]) {
      clearInterval(held.heartbeat);
      this.leases.delete(runId);
      try {
        await inTx(this.db, () => runs.releaseLease(runId, held.token, held.kept));
        this.log.warn(`KB run ${runId}: stopped with requests in flight; lease released, their answers will be asked again`);
      } catch (e) {
        this.log.warn(`KB run ${runId}: releasing the lease on shutdown failed: ${(e as Error).message}`);
      }
    }
  }
}
