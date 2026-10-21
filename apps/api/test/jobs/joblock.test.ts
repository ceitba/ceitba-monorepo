// Port of apps/api/src/test/java/org/ceitba/api/scheduling/JobLockIT.java.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { JobLock, JOBS, NAMESPACE } from '../../src/jobs/joblock';
import { silentLogger } from '../../src/infra/logger';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let lock: JobLock;
beforeAll(async () => {
  t = await testApp();
  lock = new JobLock(t.deps.config, silentLogger);
}, 60_000);
afterAll(() => t?.close());

const heldLocks = async (job: keyof typeof JOBS) =>
  Number((await t.sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND classid = ${NAMESPACE} AND objid = ${JOBS[job].id} AND objsubid = 2`)[0]!.n);

describe('JobLockIT', () => {
  beforeEach(async () => { await t.sql`DELETE FROM public.scheduled_job_run`; });

  test('skipsWhileAnotherSessionHoldsTheLock', async () => {
    let runs = 0;
    const other = postgres(t.deps.config.db.url, { max: 1 });
    const [held] = await other`SELECT pg_try_advisory_lock(${NAMESPACE}::int, ${JOBS.DATA_SYNC.id}::int) AS ok`;
    expect(held!.ok).toBe(true);
    expect(await lock.runExclusively('DATA_SYNC', () => { runs++; })).toBe(false);
    expect(runs).toBe(0);
    expect(await lock.runExclusively('MAIL_RETENTION', () => { runs++; })).toBe(true);
    expect(runs).toBe(1);
    const [released] = await other`SELECT pg_advisory_unlock(${NAMESPACE}::int, ${JOBS.DATA_SYNC.id}::int) AS ok`;
    expect(released!.ok).toBe(true);
    await other.end();
    expect(await lock.runExclusively('DATA_SYNC', () => { runs++; })).toBe(true);
    expect(runs).toBe(2);
  });

  test('skipsTheSameTickSeenByAnotherProcessAfterItFinished', async () => {
    let runs = 0;
    expect(await lock.runExclusively('KB_RELATIONS', () => { runs++; })).toBe(true);
    expect(await lock.runExclusively('KB_RELATIONS', () => { runs++; })).toBe(false);
    expect(runs).toBe(1);
    await t.sql`UPDATE public.scheduled_job_run SET last_started_at = now() - interval '31 seconds' WHERE job_id = ${JOBS.KB_RELATIONS.id}`;
    expect(await lock.runExclusively('KB_RELATIONS', () => { runs++; })).toBe(true);
    expect(runs).toBe(2);
    const [row] = await t.sql`SELECT job_name FROM public.scheduled_job_run WHERE job_id = ${JOBS.KB_RELATIONS.id}`;
    expect(row!.job_name).toBe('KB_RELATIONS');
  });

  test('releasesTheLockAfterARunEvenWhenTheTaskThrows', async () => {
    await lock.runExclusively('EVENT_REMINDERS', async () => {
      expect(await heldLocks('EVENT_REMINDERS')).toBe(1);
    });
    expect(await heldLocks('EVENT_REMINDERS')).toBe(0);
    await t.sql`DELETE FROM public.scheduled_job_run`;
    await expect(lock.runExclusively('EVENT_REMINDERS', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await heldLocks('EVENT_REMINDERS')).toBe(0);
  });

  test('twoConcurrentProcessesRunATickOnce', async () => {
    let runs = 0;
    const a = new JobLock(t.deps.config, silentLogger);
    const b = new JobLock(t.deps.config, silentLogger);
    const results = await Promise.all([a, b].map((l) => l.runExclusively('DIGEST_TICK', async () => { runs++; await Bun.sleep(200); })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });
});
