// scheduling/JobLock.java, exactly: each scheduled job runs once per tick in
// one process, across both blue/green colors and across Java and TS.
//
//   1. a dedicated connection (outside the pool) takes the session-level
//      pg_try_advisory_lock(NAMESPACE, job.id); held by someone else -> skip;
//   2. under it, claim public.scheduled_job_run: skip when another run STARTED
//      less than MIN_GAP (30 s) ago (the other color firing the same tick);
//   3. run, unlock, close the connection (a dead process frees the lock).

import postgres from 'postgres';
import type { Config } from '../config';
import { dedicatedSessionOptions } from '../db/session';
import type { Logger } from '../infra/logger';

/** "CEIT" in ASCII. */
export const NAMESPACE = 0x43454954;
export const MIN_GAP_SECONDS = 30;

/** JobLock.Job: stable ids shared with the Java app. Never reuse or renumber (8 is retired). */
export const JOBS = {
  DATA_SYNC: { id: 1, method: 'DataSyncJob#run' },
  EVENT_REMINDERS: { id: 2, method: 'EventReminderJob#run' },
  MAIL_RETENTION: { id: 3, method: 'MailRetentionJob#run' },
  KB_RELATIONS: { id: 4, method: 'KbRelationJob#run' },
  KB_EMBEDDINGS: { id: 5, method: 'KbEmbeddingJob#run' },
  DIGEST_SCHEDULE: { id: 6, method: 'DigestJob#createWeeklyDraft' },
  DIGEST_TICK: { id: 7, method: 'DigestJob#tick' },
  // 8 is reserved (was ORG_MAIL): OrgMailJob.tick runs without a lock.
  DRIVE_SYNC: { id: 9, method: 'DriveSyncJob#run' },
  KB_PIPELINE_BATCHES: { id: 10, method: 'KbPipelineJob#pollBatches' },
  KB_PIPELINE_POLL: { id: 11, method: 'KbPipelineJob#sweep' },
  KB_PIPELINE_SCHEDULE: { id: 12, method: 'KbPipelineJob#tick' },
} as const;
export type JobName = keyof typeof JOBS;

const CLAIM = `
  INSERT INTO public.scheduled_job_run (job_id, job_name, last_started_at) VALUES ($1, $2, now())
  ON CONFLICT (job_id) DO UPDATE
      SET job_name = EXCLUDED.job_name, last_started_at = EXCLUDED.last_started_at
      WHERE public.scheduled_job_run.last_started_at < now() - make_interval(secs => $3)`;

export class JobLock {
  constructor(private readonly config: Config, private readonly log: Logger) {}

  /**
   * The lock's own session. postgres.js must never recycle it while the task
   * runs (that would free the lock mid-run): see dedicatedSessionOptions.
   */
  private connect() {
    return postgres(this.config.db.url, dedicatedSessionOptions(this.config, 'ceitba-api job lock'));
  }

  /**
   * True if `task` ran here; false if another process runs/just started it or
   * the database was unreachable. An exception from the task propagates (after
   * the lock is released), like Java's Runnable.
   */
  async runExclusively(job: JobName, task: () => Promise<void> | void): Promise<boolean> {
    const { id } = JOBS[job];
    const sql = this.connect();
    try {
      let claimed: boolean;
      try {
        const [locked] = await sql.unsafe('SELECT pg_try_advisory_lock($1::int, $2::int) AS ok', [NAMESPACE, id]);
        if (!locked?.ok) {
          this.log.info(`Job ${job} skipped: another process is running it`);
          return false;
        }
      } catch (e) {
        this.log.warn(`Job ${job} skipped: could not take its lock: ${(e as Error).message}`);
        return false;
      }
      try {
        try {
          const res = await sql.unsafe(CLAIM, [id, job, MIN_GAP_SECONDS]);
          claimed = res.count === 1;
        } catch (e) {
          this.log.warn(`Job ${job} skipped: could not take its lock: ${(e as Error).message}`);
          return false;
        }
        if (!claimed) {
          this.log.info(`Job ${job} skipped: another process started it less than ${MIN_GAP_SECONDS}s ago`);
          return false;
        }
        await task();
        return true;
      } finally {
        try {
          const [unlocked] = await sql.unsafe('SELECT pg_advisory_unlock($1::int, $2::int) AS ok', [NAMESPACE, id]);
          // false: the session that took the lock ended during the run (a
          // dropped connection) and this is a new one, so another process
          // could have run the job concurrently.
          if (!unlocked?.ok) this.log.warn(`Job ${job}: its lock was lost during the run (the lock session ended)`);
        } catch (e) {
          // Closing the connection below ends the session, which frees it anyway.
          this.log.debug(`Job ${job}: unlock failed, closing the session instead: ${(e as Error).message}`);
        }
      }
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
}
