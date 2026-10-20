// Port of apps/api/src/main/java/org/ceitba/api/service/kb/progress/KbProgressMath.java
// (with the web/kb/dto/KbProgressResponse records).
//
// Pure progress computation (tested on fixtures): request rows (no payloads),
// batch jobs and run state in, KbProgressResponse out.
// `percent` is a Java double: serialize it with lib/json javaDouble at the HTTP boundary.
// TODO(kb-service): KbProgressService loads Run/Row/Job from kb_run, kb_run_request (no params)
// and kb_batch_job and maps OffsetDateTime columns to Odt.

import { asText, elements, isTextual, path, type JsonValue, type Node } from '../jsonNode';
import { ART_ZONE, formatHHmm, Odt } from '../odt';

export const LLM = ['DIGEST', 'PLAN', 'WRITE', 'RETRY'];
export const STAGES = ['DIGEST', 'PLAN', 'WRITE', 'RETRY', 'LINK', 'VALIDATE', 'PUBLISH'];
/** Expected input tokens of a request not built yet (overall weighting). */
export const DEFAULT_TOKENS: Record<string, number> = { DIGEST: 6000, PLAN: 6000, WRITE: 9000, RETRY: 11000 };
export const PAGES_PER_PLAN = 4;
export const RETRY_SHARE = 0.15;
export const SYNC_STALL_SEC = 10 * 60;
export const BATCH_STALL_SEC = 26 * 3600;
export const LATENCY_WINDOW = 10;

// ---- KbProgressResponse -------------------------------------------------------

export interface RequestCounts {
  total: number;
  completed: number;
  failed: number;
}

export interface Batch {
  doStatus: string | null;
  requestCounts: RequestCounts | null;
  submittedAt: Odt | null;
  status: string;
  error: string | null;
  nextAttemptAt: Odt | null;
}

export interface Stage {
  stage: string;
  status: string;
  total: number | null;
  done: number;
  failed: number;
  inFlight: number;
  mode: string | null;
  batch: Batch | null;
  startedAt: Odt | null;
  finishedAt: Odt | null;
}

export interface Overall {
  done: number;
  total: number;
  percent: number;
}

export interface KbProgressResponse {
  stages: Stage[];
  overall: Overall;
  current: string;
  etaSec: number | null;
  lastActivityAt: Odt | null;
  stalled: boolean;
}

// ---- inputs -------------------------------------------------------------------

/**
 * failedAnswer: answered with an error, awaiting resubmission (still SUBMITTED):
 * counted as in flight, not failed, since the engine resends it once.
 */
export class Row {
  constructor(
    readonly stage: string,
    readonly status: string,
    readonly failedAnswer: boolean,
    readonly estTokens: number,
    readonly model: string,
    readonly createdAt: Odt | null,
    readonly completedAt: Odt | null,
    readonly latencyMs: number | null,
    readonly target: string,
    readonly subjectId: string,
  ) {}

  finished(): boolean {
    return this.status === 'DONE' || this.status === 'FAILED';
  }

  failed(): boolean {
    return this.status === 'FAILED';
  }

  inFlight(): boolean {
    return this.status === 'SUBMITTED';
  }
}

/** status QUEUED: created before DO was called; nextAttemptAt/error when its creation was refused. */
export class Job {
  constructor(
    readonly stage: string,
    readonly mode: string,
    readonly status: string,
    readonly doStatus: string | null,
    readonly countTotal: number | null,
    readonly countCompleted: number | null,
    readonly countFailed: number | null,
    readonly submittedAt: Odt | null,
    readonly statusChangedAt: Odt | null,
    readonly completedAt: Odt | null,
    readonly nextAttemptAt: Odt | null = null,
    readonly error: string | null = null,
  ) {}

  open(): boolean {
    return this.mode === 'BATCH' && (this.status === 'SUBMITTED' || this.status === 'QUEUED');
  }

  rateLimited(): boolean {
    return this.status === 'QUEUED' && this.nextAttemptAt != null && this.error != null;
  }
}

/**
 * stage: the run's stage (DETECT, DIGEST..RETRY, PUBLISH, REPORT, DONE). expectedPlan:
 * PLAN requests known up front. publish*: subjects for the PUBLISH stage (pipeline only).
 */
export class Run {
  constructor(
    readonly eval_: boolean,
    readonly stage: string,
    readonly status: string,
    readonly dryRun: boolean,
    readonly startedAt: Odt | null,
    readonly finishedAt: Odt | null,
    readonly stageLog: JsonValue | null,
    readonly expectedPlan: number,
    readonly publishTotal: number,
    readonly publishDone: number,
    readonly publishFailed: number,
    readonly error: string | null,
  ) {}

  active(): boolean {
    return ['RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT'].includes(this.status);
  }
}

export function index(stage: string): number {
  switch (stage) {
    case 'DETECT':
      return -1;
    case 'DIGEST':
      return 0;
    case 'PLAN':
      return 1;
    case 'WRITE':
      return 2;
    case 'RETRY':
      return 3;
    case 'LINK':
      return 4;
    case 'VALIDATE':
    case 'REPORT':
      return 5;
    case 'PUBLISH':
      return 6;
    default:
      return 7; // DONE
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Comparator.naturalOrder() max/min over non-null times (ties keep the first, like maxBy/minBy). */
function maxTime(ts: (Odt | null)[]): Odt | null {
  let best: Odt | null = null;
  for (const t of ts) if (t != null && (best == null || t.compareTo(best) > 0)) best = t;
  return best;
}

function minTime(ts: (Odt | null)[]): Odt | null {
  let best: Odt | null = null;
  for (const t of ts) if (t != null && (best == null || t.compareTo(best) < 0)) best = t;
  return best;
}

export function compute(run: Run, rows: Row[], jobs: Job[], concurrency: number, now: Odt): KbProgressResponse {
  const byStage = groupBy(rows, (r) => r.stage);
  // Where the run is (failed/cancelled runs: the stage they stopped at).
  let cur = index(run.stage);
  const ended = !run.active();
  const succeeded = run.status === 'SUCCEEDED' || run.status === 'PARTIAL';
  if (succeeded) cur = 7;

  const stages: Stage[] = [];
  let wDone = 0;
  let wTotal = 0;
  const writeRows = (byStage.get('WRITE') ?? []).length;
  for (const s of STAGES) {
    const i = index(s);
    const list = byStage.get(s) ?? [];
    const stageJobs = jobs.filter((j) => j.stage === s);
    // max by submittedAt (null = OffsetDateTime.MAX); ties keep the first.
    let batchJob: Job | null = null;
    for (const j of stageJobs.filter((x) => x.mode === 'BATCH')) {
      if (batchJob == null) {
        batchJob = j;
        continue;
      }
      const a = batchJob.submittedAt;
      const b = j.submittedAt;
      const c = a == null ? (b == null ? 0 : 1) : b == null ? -1 : a.compareTo(b);
      if (c < 0) batchJob = j;
    }
    const mode = stageJobs.length === 0 ? null : stageJobs[stageJobs.length - 1]!.mode.toLowerCase();
    const openBatch = stageJobs.some((j) => j.open());

    let total: number | null;
    let done: number;
    let failed: number;
    let inFlight: number;
    if (LLM.includes(s)) {
      if (list.length > 0) {
        total = list.length;
        done = list.filter((r) => r.status === 'DONE').length;
        failed = list.filter((r) => r.failed()).length;
        inFlight = list.filter((r) => r.inFlight()).length;
      } else {
        total = s === 'PLAN' && i >= cur && !ended ? run.expectedPlan : i < cur || ended ? 0 : null;
        if (s === 'DIGEST' && i >= cur && !ended) total = null;
        done = 0;
        failed = 0;
        inFlight = 0;
      }
      // Batch stages: DO's request_counts while the batch is open.
      if (openBatch && batchJob != null && batchJob.countTotal != null) {
        total = Math.max(total == null ? 0 : total, batchJob.countTotal);
        done = batchJob.countCompleted == null ? done : batchJob.countCompleted;
        failed = batchJob.countFailed == null ? failed : batchJob.countFailed;
        inFlight = Math.max(0, total - done - failed);
      }
    } else if (s === 'PUBLISH') {
      total = run.eval_ || run.dryRun ? 0 : run.publishTotal;
      done = run.publishDone;
      failed = run.publishFailed;
      inFlight = 0;
    } else {
      // LINK / VALIDATE: the written pages, linked and validated in code.
      total = writeRows > 0 || cur > index('WRITE') ? writeRows : null;
      const through = cur > index('WRITE') && !(s === 'VALIDATE' && run.stage === 'REPORT');
      done = through ? writeRows : 0;
      failed = 0;
      inFlight = 0;
    }

    // Sync jobs mark every row submitted up front; only `concurrency` are in flight.
    if (!openBatch && mode === 'sync') inFlight = Math.min(inFlight, concurrency);
    if (ended) inFlight = 0; // abandoned when the run ended

    let status: string;
    const skippable = (run.eval_ && s === 'PUBLISH') || (run.dryRun && i > index('PLAN'));
    if (skippable) status = 'skipped';
    else if (succeeded) status = total != null && total === 0 ? 'skipped' : 'done';
    else if (i < cur) status = total != null && total === 0 ? 'skipped' : 'done';
    else if (i === cur || (s === 'VALIDATE' && run.stage === 'REPORT')) {
      if (ended) status = 'failed';
      else if (openBatch) status = 'waiting_batch';
      else status = 'running';
    } else status = ended ? 'skipped' : 'pending';
    if (s === 'LINK' && run.stage === 'REPORT') status = 'done';

    const log = run.stageLog == null ? null : path(run.stageLog, s);
    let startedAt = time(log, 'startedAt');
    if (startedAt == null && list.length > 0) startedAt = minTime(list.map((r) => r.createdAt));
    let finishedAt = time(log, 'finishedAt');
    if (finishedAt == null && (status === 'done' || status === 'failed') && list.length > 0) {
      finishedAt = maxTime(list.map((r) => r.completedAt));
    }
    if (s === 'VALIDATE' || s === 'LINK') {
      const w = run.stageLog == null ? null : path(run.stageLog, 'WRITE');
      if (startedAt == null && status === 'done') startedAt = time(w, 'finishedAt');
      if (finishedAt == null && status === 'done') finishedAt = startedAt;
    }
    const batch: Batch | null =
      batchJob == null
        ? null
        : {
            doStatus: batchJob.doStatus,
            requestCounts:
              batchJob.countTotal == null
                ? null
                : { total: batchJob.countTotal, completed: nz(batchJob.countCompleted), failed: nz(batchJob.countFailed) },
            submittedAt: batchJob.submittedAt,
            status: batchJob.status,
            error: batchJob.error,
            nextAttemptAt: batchJob.nextAttemptAt,
          };
    stages.push({ stage: s, status, total, done, failed, inFlight, mode: LLM.includes(s) ? mode : null, batch, startedAt, finishedAt });

    // Weighting (LLM stages only; code stages are instant).
    if (LLM.includes(s) && status !== 'skipped') {
      const w = weight(s, list, total, done + failed, status, run, byStage);
      wDone += w[0];
      wTotal += w[1];
    }
  }
  if (succeeded) wDone = wTotal;
  const percent = wTotal === 0 ? (succeeded ? 100 : 0) : Math.min(100, Math.round((wDone * 1000.0) / wTotal) / 10.0);
  const overall: Overall = { done: wDone, total: wTotal, percent };

  const lastActivityAt = lastActivity(run, rows, jobs);
  const currentStage = stages.find((x) => x.status === 'running' || x.status === 'waiting_batch') ?? null;
  const batchWait = currentStage != null && currentStage.status === 'waiting_batch';
  const stalled =
    run.active() &&
    run.status !== 'BLOCKED_BY_COST_LIMIT' &&
    lastActivityAt != null &&
    durationExceeds(lastActivityAt, now, batchWait ? BATCH_STALL_SEC : SYNC_STALL_SEC);
  const etaSec = run.active() && !batchWait && run.status !== 'BLOCKED_BY_COST_LIMIT' ? eta(rows, stages, run, byStage, concurrency) : null;
  return { stages, overall, current: current(run, currentStage, byStage, jobs), etaSec, lastActivityAt, stalled };
}

/** Duration.between(a, b).compareTo(limit) > 0, exact to the nanosecond. */
function durationExceeds(a: Odt, b: Odt, limitSec: number): boolean {
  const sec = b.epochSecond - a.epochSecond;
  const nano = b.nano - a.nano;
  return sec > limitSec || (sec === limitSec && nano > 0);
}

/** [done, total] in estimated tokens for one LLM stage. */
export function weight(s: string, list: Row[], total: number | null, finished: number, status: string, run: Run, byStage: Map<string, Row[]>): [number, number] {
  if (list.length > 0) {
    const all = list.reduce((a, r) => a + r.estTokens, 0);
    let fin = list.filter((r) => r.finished()).reduce((a, r) => a + r.estTokens, 0);
    // Batch counts may run ahead of the rows (recorded when collected).
    if (total != null && total > 0 && finished > list.filter((r) => r.finished()).length) {
      fin = Math.trunc((all * Math.min(finished, total)) / total);
    }
    return [fin, all];
  }
  const per = DEFAULT_TOKENS[s]!;
  let expected: number;
  switch (s) {
    case 'PLAN':
      expected = run.expectedPlan * per;
      break;
    case 'WRITE':
      expected = Math.max(1, planCount(run, byStage)) * PAGES_PER_PLAN * per;
      break;
    case 'RETRY':
      expected = Math.ceil(estimatedWrites(run, byStage) * RETRY_SHARE) * per;
      break;
    default:
      expected = total == null ? 0 : total * per;
  }
  return [0, status === 'done' ? 0 : expected];
}

export function planCount(run: Run, byStage: Map<string, Row[]>): number {
  const plan = byStage.get('PLAN') ?? [];
  return plan.length === 0 ? run.expectedPlan : plan.length;
}

export function estimatedWrites(run: Run, byStage: Map<string, Row[]>): number {
  const write = byStage.get('WRITE') ?? [];
  return write.length === 0 ? planCount(run, byStage) * PAGES_PER_PLAN : write.length;
}

/**
 * Remaining requests (current and later LLM stages, estimated where unknown) x
 * moving average latency / concurrency. Without latencies, the average gap between
 * the last completions.
 */
export function eta(rows: Row[], stages: Stage[], run: Run, byStage: Map<string, Row[]>, concurrency: number): number | null {
  let remaining = 0;
  for (const st of stages) {
    if (!LLM.includes(st.stage)) continue;
    if (st.status === 'done' || st.status === 'skipped') continue;
    if (st.total != null && (byStage.get(st.stage) ?? []).length > 0) {
      remaining += Math.max(0, st.total - st.done - st.failed);
    } else if (st.stage === 'PLAN') {
      remaining += run.expectedPlan;
    } else if (st.stage === 'WRITE') {
      remaining += planCount(run, byStage) * PAGES_PER_PLAN;
    } else if (st.stage === 'RETRY') {
      remaining += Math.ceil(estimatedWrites(run, byStage) * RETRY_SHARE);
    }
  }
  if (remaining === 0) return null;
  // sorted(comparing(completedAt).reversed()): stable, latest first.
  const finished = rows
    .filter((r) => r.completedAt != null)
    .slice()
    .sort((a, b) => b.completedAt!.compareTo(a.completedAt!))
    .slice(0, LATENCY_WINDOW);
  const latencies = finished.map((r) => r.latencyMs).filter((l): l is number => l != null);
  if (latencies.length > 0) {
    const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    return Math.round((remaining * avgMs) / 1000.0 / Math.max(1, Math.min(concurrency, remaining)));
  }
  if (finished.length >= 2) {
    const first = finished[finished.length - 1]!.completedAt!;
    const last = finished[0]!.completedAt!;
    const gapSec = first.millisUntil(last) / 1000.0 / (finished.length - 1);
    return Math.round(remaining * gapSec);
  }
  return null;
}

export function lastActivity(run: Run, rows: Row[], jobs: Job[]): Odt | null {
  const times: (Odt | null)[] = [run.startedAt];
  for (const r of rows) times.push(r.completedAt);
  for (const j of jobs) times.push(j.submittedAt, j.statusChangedAt, j.completedAt);
  if (run.stageLog != null) {
    for (const n of elements(run.stageLog)) times.push(time(n, 'startedAt'), time(n, 'finishedAt'));
  }
  return maxTime(times);
}

export function current(run: Run, st: Stage | null, byStage: Map<string, Row[]>, jobs: Job[] = []): string {
  switch (run.status) {
    case 'SUCCEEDED':
      return 'Terminado';
    case 'PARTIAL':
      return 'Terminado con fallas' + (run.error == null ? '' : ': ' + run.error);
    case 'CANCELLED':
      return 'Cancelado';
    case 'FAILED':
      return 'Falló en ' + stageName(run.stage) + (run.error == null ? '' : ': ' + run.error);
    case 'BLOCKED_BY_COST_LIMIT':
      return 'Bloqueado por el límite de costo semanal: requiere aprobación';
    case 'WAITING':
      if (run.error != null && run.error.startsWith('Cupo diario')) return run.error;
      break;
    default:
      break;
  }
  if (run.stage === 'DETECT') return run.eval_ ? 'Preparando la evaluación' : 'Detectando cambios';
  if (run.stage === 'REPORT') return 'Calculando las métricas de la evaluación';
  if (st == null) return stageName(run.stage);
  if (!LLM.includes(st.stage)) return stageName(st.stage);
  let line = stageName(st.stage);
  line += ' (' + (st.done + st.failed) + '/' + (st.total == null ? 'por determinar' : st.total) + ')';
  const ms = models(byStage.get(st.stage) ?? [], () => true);
  if (ms.length > 0) line += ' con ' + ms;
  if (st.status === 'waiting_batch') {
    const limited = minTime(jobs.filter((j) => j.stage === st.stage && j.rateLimited()).map((j) => j.nextAttemptAt));
    if (limited != null) {
      const at = formatHHmm(limited, ART_ZONE);
      const wait = jobs.find((j) => j.stage === st.stage && j.rateLimited() && j.error!.startsWith('QUOTA_WAIT: '));
      if (wait != null) {
        return line + ': ' + wait.error!.substring('QUOTA_WAIT: '.length) + '; reintento a las ' + at;
      }
      const rate = jobs.some((j) => j.stage === st.stage && j.rateLimited() && j.error!.startsWith('RATE_LIMITED'));
      line +=
        (rate
          ? ': DigitalOcean limitó la creación de lotes; reintento a las '
          : ': DigitalOcean no respondió al crear el lote; reintento a las ') + at;
    } else {
      line += ': esperando el lote de DigitalOcean';
    }
  }
  return line;
}

export function stageName(stage: string): string {
  switch (stage) {
    case 'DIGEST':
      return 'Generando resúmenes de archivos';
    case 'PLAN':
      return 'Planificando las páginas';
    case 'WRITE':
      return 'Escribiendo páginas';
    case 'RETRY':
      return 'Corrigiendo páginas rechazadas';
    case 'LINK':
      return 'Enlazando páginas';
    case 'VALIDATE':
      return 'Validando páginas';
    case 'PUBLISH':
      return 'Publicando';
    case 'REPORT':
      return 'Calculando las métricas de la evaluación';
    case 'DETECT':
      return 'Detectando cambios';
    default:
      return stage;
  }
}

/** "a", "a y b", "a, b y c" by request count (ties: first seen first). */
export function models(rows: Row[], filter: (r: Row) => boolean): string {
  const counts = new Map<string, number>();
  for (const r of rows) if (filter(r)) counts.set(r.model, (counts.get(r.model) ?? 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (names.length <= 1) return names.length === 0 ? '' : names[0]!;
  return names.slice(0, names.length - 1).join(', ') + ' y ' + names[names.length - 1];
}

/**
 * {done, total, percent} of a subset of rows (an eval configuration), with the same
 * weighting; unknown stages estimated per configuration.
 */
export function subset(rows: Row[], run: Run, expectedPlan: number): Overall {
  let done = 0;
  let total = 0;
  const byStage = groupBy(rows, (r) => r.stage);
  const cfgRun = new Run(run.eval_, run.stage, run.status, run.dryRun, run.startedAt, run.finishedAt, run.stageLog, expectedPlan, 0, 0, 0, run.error);
  const completed = run.status === 'SUCCEEDED' || run.status === 'PARTIAL';
  const cur = completed ? 7 : index(run.stage);
  for (const s of ['PLAN', 'WRITE', 'RETRY']) {
    const list = byStage.get(s) ?? [];
    if (list.length === 0 && (index(s) < cur || !run.active())) continue; // passed with nothing
    const w = weight(s, list, list.length === 0 ? null : list.length, list.filter((r) => r.finished()).length, 'pending', cfgRun, byStage);
    done += w[0];
    total += w[1];
  }
  if (completed) done = total;
  const percent = total === 0 ? (completed ? 100 : 0) : Math.min(100, Math.round((done * 1000.0) / total) / 10.0);
  return { done, total, percent };
}

function nz(v: number | null): number {
  return v == null ? 0 : v;
}

export function time(n: Node | null, field: string): Odt | null {
  if (n == null || !isTextual(path(n, field))) return null;
  return Odt.tryParse(asText(path(n, field)));
}
