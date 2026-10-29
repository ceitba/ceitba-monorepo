// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbBatchSubmitter.java
// (with KbPagedLines).
//
// Idempotent DO batch submission (docs/SUBJECT-WIKI-PIPELINE.md, "Batch submission"):
//   1. queue(): the kb_batch_job row (QUEUED) and its requests are written in
//      their own transaction BEFORE DO is called; the unique index on (run,
//      stage, attempt, model, part) makes a second advancer find the row and never
//      submit again.
//   2. submitQueued(): creates the DO batch with the deterministic request_id
//      <runId>:<stage>:<attempt>:<model>. A 429 (or no response / 5xx) keeps
//      the job QUEUED with nextAttemptAt (1, 5, 15, 60 min, then hourly); the
//      poller retries it when due. Before re-creating after a failure, DO's
//      batch list is checked for that request_id. Any other refusal fails the
//      job (and its requests) with DO's message: there is no fallback to sync.
// Callers hold the run's lease (KbRunEngine.advance).

import { classify } from '../external/doBatchErrors';
import { DoBatchSlotError, LlmApiError } from '../external/llmApi';
import type { Now, Odt } from '../odt';
import { DuplicateKeyError, type KbBatchJobStore, type KbRunRequestStore, type KbRunStore, type Tx } from '../ports';
import { KbBatchJob } from '../types';
import type { BatchLlmExecutor } from '../llm/batchLlmExecutor';
import type { KbLlmRouter } from '../llm/kbLlmRouter';
import type { LlmLine } from '../llm/syncLlmExecutor';

export const BACKOFF_MINUTES = [1, 5, 15, 60];

/** Prefix of the job error while waiting for a batch slot (progress shows it). */
export const QUOTA_WAIT = 'QUOTA_WAIT: ';

/** KbRunEngine.MOVING. */
export const MOVING = ['RUNNING', 'WAITING'] as const;

export type Outcome = 'SUBMITTED' | 'WAITING' | 'FAILED';

/** Wait before the n-th retry of a refused creation (n = failures so far, 1-based), in minutes. */
export function backoffMinutes(failures: number): number {
  return BACKOFF_MINUTES[Math.max(0, Math.min(failures, BACKOFF_MINUTES.length) - 1)]!;
}

export function requestId(runId: string, stage: string, attempt: number, model: string, part = 1): string {
  const base = `${runId}:${stage}:${attempt}:${model}`;
  // Part 1 keeps the unsplit id (batches created before the split existed).
  return part <= 1 ? base : `${base}:p${part}`;
}

/** `ids` cut into consecutive parts of at most `max` (one batch job each). */
export function split<T>(ids: T[], max: number): T[][] {
  const out: T[][] = [];
  const size = Math.max(1, max);
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, Math.min(ids.length, i + size)));
  return out;
}

export const PAGE = 100;
const ID_PAGE = 1000;

/**
 * KbPagedLines: the requests' canonical lines for a list of custom ids, `page` at a
 * time (each page in its own transaction), in id order; missing ids are skipped.
 */
export async function* pagedLines(ids: string[], page: number, tx: Tx, requests: KbRunRequestStore): AsyncGenerator<LlmLine> {
  const size = Math.max(1, page);
  for (let next = 0; next < ids.length; next += size) {
    const slice = ids.slice(next, Math.min(ids.length, next + size));
    const byId = await tx(async () => {
      const m = new Map<string, LlmLine>();
      for (const r of await requests.findAllById(slice)) m.set(r.customId, { customId: r.customId, params: r.params });
      return m;
    });
    for (const id of slice) {
      const l = byId.get(id);
      if (l !== undefined) yield l;
    }
  }
}

export class KbBatchSubmitter {
  constructor(
    private readonly jobs: KbBatchJobStore,
    private readonly requests: KbRunRequestStore,
    private readonly runs: KbRunStore,
    private readonly batch: BatchLlmExecutor,
    private readonly router: KbLlmRouter,
    private readonly tx: Tx,
    private readonly now: Now,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /**
   * When to retry a refused creation. A refused creation counts against
   * batch-creations-per-hour, so a 429 for that quota waits a full hour (2 min for
   * the per-minute one); other transient errors use backoff().
   */
  creationRetryAt(e: LlmApiError, failures: number): Odt {
    let at = this.now().plusMinutes(backoffMinutes(failures));
    const msg = e.message ?? '';
    if (msg.includes('batch_creations_per_hour') || msg.includes('batch_create_per_minute')) {
      const hour = this.now().plusMinutes(msg.includes('batch_creations_per_hour') ? 60 : 2);
      if (at.isBefore(hour)) at = hour;
    }
    return at;
  }

  /**
   * The QUEUED job of (run, stage, attempt, model, part) with its requests attached;
   * null when that row already exists (queued by someone else: nothing to submit).
   */
  async queue(runId: string, stage: string, attempt: number, model: string, part: number, customIds: string[], payloadKey: string): Promise<KbBatchJob | null> {
    try {
      return await this.tx(async () => {
        const job = new KbBatchJob(runId, stage, attempt, model, 'BATCH', customIds.length, payloadKey).withPart(part);
        job.queued(requestId(runId, stage, attempt, model, part));
        const saved = await this.jobs.saveAndFlush(job);
        // Bulk updates: no request (with its params) is loaded.
        for (let i = 0; i < customIds.length; i += ID_PAGE) {
          await this.requests.markSubmitted(saved.id!, customIds.slice(i, Math.min(customIds.length, i + ID_PAGE)));
        }
        return saved;
      });
    } catch (e) {
      if (e instanceof DuplicateKeyError) {
        this.log(`KB run ${runId} ${stage} attempt ${attempt} (${model}) is already queued; not submitting again`);
        return null;
      }
      throw e;
    }
  }

  /** queue() for an unsplit stage (part 1). */
  queueStage(runId: string, stage: string, attempt: number, model: string, customIds: string[], payloadKey: string): Promise<KbBatchJob | null> {
    return this.queue(runId, stage, attempt, model, 1, customIds, payloadKey);
  }

  private async job(jobId: string): Promise<KbBatchJob> {
    const j = await this.jobs.findById(jobId);
    if (j == null) throw new Error(`No value present (kb_batch_job ${jobId})`);
    return j;
  }

  /** Creates the DO batch of a QUEUED job when it is due. */
  async submitQueued(jobId: string): Promise<Outcome> {
    const job = await this.tx(() => this.job(jobId));
    if (job.status === 'SUBMITTED') return 'SUBMITTED';
    if (job.status !== 'QUEUED') return 'FAILED';
    const now = this.now();
    if (job.nextAttemptAt != null && now.isBefore(job.nextAttemptAt)) return 'WAITING';
    const rid = job.doRequestId ?? requestId(job.runId, job.stage, job.attempt, job.model, job.part);
    if (job.submitFailures > 0) {
      // A creation that got no clear answer may have gone through.
      try {
        const existing = await this.batch.findByRequestId(rid);
        if (existing != null && existing.id != null) {
          await this.markSubmitted(job, null, existing.id);
          return 'SUBMITTED';
        }
      } catch (e) {
        if (!(e instanceof LlmApiError)) throw e;
        this.log(`KB batch list unavailable: ${e.message}`);
      }
    }
    const ids = await this.tx(() => this.requests.submittedIdsOfJob(jobId));
    if (ids.length === 0) {
      await this.tx(async () => {
        const j = await this.job(jobId);
        j.finish('FAILED', null, this.now(), 'no requests to submit');
        await this.jobs.save(j);
      });
      return 'FAILED';
    }
    try {
      const submitted = await this.batch.submit(
        (job.payloadKey ?? '').replaceAll('/', '_'),
        job.model,
        await this.router.batchModelId(job.model),
        pagedLines(ids, PAGE, this.tx, this.requests),
        rid,
      );
      await this.markSubmitted(job, submitted.fileId, submitted.batchId);
      this.log(`KB run ${job.runId} ${job.stage} batch ${submitted.batchId} submitted (${ids.length} requests, ${job.model})`);
      return 'SUBMITTED';
    } catch (e) {
      if (!(e instanceof LlmApiError)) throw e;
      const kind = classify(e.status, e.message);
      if (kind === 'RATE_LIMITED' || kind === 'TRANSIENT') {
        // A snapshot-based wait (no DO call made) has its own time and message.
        const slot = e instanceof DoBatchSlotError ? e : null;
        const at = slot != null ? slot.retryAt : this.creationRetryAt(e, job.submitFailures + 1);
        await this.tx(async () => {
          const j = await this.job(jobId);
          j.retryAt(
            at,
            slot != null
              ? QUOTA_WAIT + slot.message.replace(' (rate_limit_exceeded)', '')
              : (kind === 'RATE_LIMITED' ? 'RATE_LIMITED: ' : 'UNAVAILABLE: ') + e.message,
          );
          await this.jobs.save(j);
          await this.runs.setStatusIf(job.runId, 'WAITING', MOVING);
        });
        this.log(`KB run ${job.runId} ${job.stage} batch creation refused (${e.message}); retry at ${at.toString()}`);
        return 'WAITING';
      }
      const error = 'DigitalOcean rejected the batch: ' + e.message;
      await this.tx(async () => {
        const j = await this.job(jobId);
        j.finish('FAILED', null, this.now(), error);
        await this.jobs.save(j);
        await this.requests.failSubmittedOfJob(jobId, error);
      });
      this.log(`KB run ${job.runId} ${job.stage} batch rejected: ${e.message}`);
      return 'FAILED';
    }
  }

  private async markSubmitted(job: KbBatchJob, fileId: string | null, batchId: string | null): Promise<void> {
    await this.tx(async () => {
      const j = await this.job(job.id!);
      j.submitted(fileId, batchId, this.now());
      await this.jobs.save(j);
      // Conditional: a cancel that landed during the HTTP call sticks.
      await this.runs.setStatusIf(job.runId, 'RUNNING', MOVING);
    });
  }
}
