// Not in the Java suite: during a blue/green deploy (and the Java -> Bun
// cutover or a rollback) a Java and a Bun process fire the same ticks on one
// database. Here the Java side is its JDBC statements from scheduling/JobLock.java,
// verbatim, run from another session (JDBC setInt/setString/setLong bind int4,
// text and int8, like the literals below), so the two must exclude each other.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { JobLock, JOBS, MIN_GAP_SECONDS, NAMESPACE } from '../../src/jobs/joblock';
import { silentLogger } from '../../src/infra/logger';
import { testApp, type TestApp } from '../support/app';

// JobLock.java's CLAIM, with JDBC's ? as $n.
const JAVA_CLAIM = `
  INSERT INTO public.scheduled_job_run (job_id, job_name, last_started_at) VALUES ($1, $2, now())
  ON CONFLICT (job_id) DO UPDATE
      SET job_name = EXCLUDED.job_name, last_started_at = EXCLUDED.last_started_at
      WHERE public.scheduled_job_run.last_started_at < now() - make_interval(secs => $3)`;

let t: TestApp;
let lock: JobLock;
let java: ReturnType<typeof postgres>;
beforeAll(async () => {
  t = await testApp();
  lock = new JobLock(t.deps.config, silentLogger);
  java = postgres(t.deps.config.db.url, { max: 1, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await java?.end();
  await t?.close();
});

/** JobLock.call(conn, "SELECT pg_try_advisory_lock(?, ?)", job): two int4 parameters. */
const javaTryLock = async (id: number) => (await java.unsafe('SELECT pg_try_advisory_lock($1::int4, $2::int4) AS ok', [NAMESPACE, id]))[0]!.ok as boolean;
const javaUnlock = async (id: number) => (await java.unsafe('SELECT pg_advisory_unlock($1::int4, $2::int4) AS ok', [NAMESPACE, id]))[0]!.ok as boolean;
const advisoryLocks = (id: number) => t.sql`SELECT classid::int AS classid, objid::int AS objid, objsubid::int AS objsubid, pid
  FROM pg_locks WHERE locktype = 'advisory' AND granted AND classid = ${NAMESPACE} AND objid = ${id}`;

describe('JobLock across Java and Bun', () => {
  beforeEach(async () => { await t.sql`DELETE FROM public.scheduled_job_run`; });

  test('theNamespaceIsCeitInAscii', () => {
    expect(NAMESPACE).toBe(0x43454954);
    expect(Buffer.from('CEIT').readInt32BE(0)).toBe(NAMESPACE);
  });

  test('bunSkipsWhileJavaHoldsTheAdvisoryLock', async () => {
    const id = JOBS.DATA_SYNC.id;
    expect(await javaTryLock(id)).toBe(true);
    // The (int4, int4) form: pg_locks keys it as classid = namespace, objid = id, objsubid = 2.
    const held = await advisoryLocks(id);
    expect(held.map((l) => [l.classid, l.objid, l.objsubid])).toEqual([[NAMESPACE, id, 2]]);
    let runs = 0;
    expect(await lock.runExclusively('DATA_SYNC', () => { runs++; })).toBe(false);
    expect(runs).toBe(0);
    expect(await javaUnlock(id)).toBe(true);
    expect(await lock.runExclusively('DATA_SYNC', () => { runs++; })).toBe(true);
    expect(runs).toBe(1);
  });

  test('javaSkipsWhileBunHoldsTheAdvisoryLock', async () => {
    const id = JOBS.DRIVE_SYNC.id;
    let javaGotIt = null as boolean | null;
    let bunLock: unknown[] = [];
    expect(await lock.runExclusively('DRIVE_SYNC', async () => {
      bunLock = (await advisoryLocks(id)).map((l) => [l.classid, l.objid, l.objsubid]);
      javaGotIt = await javaTryLock(id);
    })).toBe(true);
    expect(bunLock).toEqual([[NAMESPACE, id, 2]]);
    expect(javaGotIt).toBe(false);
    expect(await advisoryLocks(id)).toHaveLength(0);
  });

  test('aClaimJavaWroteWithinMinGapMakesBunSkipTheTick', async () => {
    const id = JOBS.DIGEST_SCHEDULE.id;
    // Java claims the tick (its row: job_name = the enum name, last_started_at = now()).
    expect((await java.unsafe(JAVA_CLAIM, [id, 'DIGEST_SCHEDULE', MIN_GAP_SECONDS])).count).toBe(1);
    let runs = 0;
    expect(await lock.runExclusively('DIGEST_SCHEDULE', () => { runs++; })).toBe(false);
    expect(runs).toBe(0);
    // A Java run older than MIN_GAP is the previous tick: Bun runs this one.
    await t.sql`UPDATE public.scheduled_job_run SET last_started_at = now() - make_interval(secs => ${MIN_GAP_SECONDS + 1}) WHERE job_id = ${id}`;
    expect(await lock.runExclusively('DIGEST_SCHEDULE', () => { runs++; })).toBe(true);
    expect(runs).toBe(1);
    const [row] = await t.sql`SELECT job_name FROM public.scheduled_job_run WHERE job_id = ${id}`;
    expect(row!.job_name).toBe('DIGEST_SCHEDULE');
  });

  test('aClaimBunWroteWithinMinGapMakesJavaSkipTheTick', async () => {
    const id = JOBS.EVENT_REMINDERS.id;
    expect(await lock.runExclusively('EVENT_REMINDERS', () => {})).toBe(true);
    const [row] = await t.sql`SELECT job_id, job_name FROM public.scheduled_job_run WHERE job_id = ${id}`;
    // Same row shape Java writes: its enum name.
    expect(row).toEqual({ job_id: id, job_name: 'EVENT_REMINDERS' });
    expect((await java.unsafe(JAVA_CLAIM, [id, 'EVENT_REMINDERS', MIN_GAP_SECONDS])).count).toBe(0);
  });

  test('everyJobIdMatchesTheJavaEnum', () => {
    // JobLock.Job in apps/api (frozen here: ids are shared across runtimes and never renumbered).
    expect(Object.fromEntries(Object.entries(JOBS).map(([k, v]) => [k, v.id]))).toEqual({
      DATA_SYNC: 1, EVENT_REMINDERS: 2, MAIL_RETENTION: 3, KB_RELATIONS: 4, KB_EMBEDDINGS: 5, DIGEST_SCHEDULE: 6,
      DIGEST_TICK: 7, DRIVE_SYNC: 9, KB_PIPELINE_BATCHES: 10, KB_PIPELINE_POLL: 11, KB_PIPELINE_SCHEDULE: 12,
    });
  });
});
