// The restart-loop guard (docs/SUBJECT-WIKI-PIPELINE.md "Restart-loop guard") against
// blue/green deploys, TS-only (no Java counterpart). Each KbRunEngine built here plays one
// API process ("color") on the same database; the fake chat client is held mid-request so
// an engine can be stopped, or abandoned (a crash), while it holds a run's lease.
//
//   (a) graceful restarts, more than MAX_RESUMES of them, never fail a RUNNING run;
//   (b) unclean restarts (the holder vanished, its lease left behind) still fail it;
//   (c) the blue/green order: the new color resumes BEFORE the old one stops; the old
//       color's clean release undoes that resume, and cannot hide a crash loop after it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { LEASE_MS, MAX_RESUMES, RESUME_LOOP_ERROR, KbRunEngine } from '../../src/features/kb-pipeline/engine';
import { runs } from '../../src/features/kb-pipeline/db/repo';
import { inTx } from '../../src/features/kb-pipeline/db/session';
import { DbKbRunRequestStore } from '../../src/features/kb-pipeline/db/stores';
import { nowOf } from '../../src/features/kb-pipeline/service';
import { MutableClock } from '../../src/infra/clock';
import { silentLogger } from '../../src/infra/logger';
import { Acceptance, responder } from './support';

const clock = new MutableClock();
// One request in flight at a time, so a stop leaves the rest of the stage unsent.
const a = new Acceptance({ KB_EXECUTION_MODE: 'sync', KB_SYNC_CONCURRENCY: '1' }, { clock });

beforeAll(() => a.start(), 60_000);
afterAll(() => a.close());

/** A gate the fake chat client waits on before answering (a request in flight). */
class Gate {
  private open = true;
  private waiters: (() => void)[] = [];
  close(): void {
    this.open = false;
  }
  release(): void {
    this.open = true;
    for (const w of this.waiters.splice(0)) w();
  }
  wait(): Promise<void> {
    return this.open ? Promise.resolve() : new Promise((r) => this.waiters.push(r));
  }
}

const gate = new Gate();
const engines: KbRunEngine[] = [];
const pending: Promise<unknown>[] = [];

/** A new API process on the same database (its own engine, same collaborators). */
function color(): KbRunEngine {
  const kb = a.kb();
  const deps = a.t.deps;
  const e = new KbRunEngine({
    db: deps.db, storage: deps.storage, log: silentLogger, now: nowOf(deps), router: kb.router, batch: kb.batch,
    submitter: kb.submitter, sync: kb.sync, usage: kb.usage, settings: kb.settings, costs: kb.costs,
    requestStore: new DbKbRunRequestStore(deps.db), background: false,
  });
  e.register(kb.pipeline);
  engines.push(e);
  return e;
}

async function state(id: string): Promise<{ status: string; stage: string; count: number; owner: string | null; error: string | null }> {
  const [r] = await a.sql`SELECT status, stage, resume_count, lease_owner, error FROM wiki.kb_run WHERE id = ${id}::uuid`;
  return { status: String(r!.status), stage: String(r!.stage), count: Number(r!.resume_count), owner: (r!.lease_owner as string | null) ?? null, error: (r!.error as string | null) ?? null };
}

/** Waits until the fake chat client got `n` requests (the engine is mid-request). */
async function untilReceived(n: number): Promise<void> {
  for (let i = 0; i < 500 && a.fakeSync().received().length < n; i++) await Bun.sleep(10);
  expect(a.fakeSync().received().length).toBeGreaterThanOrEqual(n);
}

/** Starts advancing the run on `e` and returns once a request is in flight (the gate is closed). */
async function advancingMidRequest(e: KbRunEngine, id: string): Promise<void> {
  const before = a.fakeSync().received().length;
  gate.close();
  pending.push(e.advance(id));
  await untilReceived(before + 1);
}

/** A process that died holding the run: its lease stays, nobody releases it. */
async function crashedHolder(id: string): Promise<void> {
  const now = nowOf(a.t.deps)();
  expect(await inTx(a.t.deps.db, () => runs.takeLease(id, 'dead-' + crypto.randomUUID(), now.plusSeconds(LEASE_MS / 1000), now))).toBe(1);
}

async function startRun(): Promise<string> {
  return (await a.kb().pipeline.trigger('MANUAL', false)).id as string;
}

describe('KbRunEngine restart-loop guard', () => {
  beforeEach(async () => {
    clock.set(new Date());
    await a.seed();
    const base = responder(false);
    a.respond(async (r) => {
      await gate.wait();
      return base(r);
    });
  });

  afterEach(async () => {
    gate.release();
    for (const e of engines.splice(0)) await e.stop();
    await Promise.allSettled(pending.splice(0));
  });

  // (a) + (c): blue/green, more times than the guard allows. Each deploy: the new color
  // starts and resumes the run while the old color still advances it (lease held), then
  // the old color gets SIGTERM and stops, its in-flight request still unanswered.
  test('gracefulBlueGreenRestartsNeverFailARunningRun', async () => {
    const id = await startRun();
    let serving = color();
    await advancingMidRequest(serving, id);
    for (let deploy = 1; deploy <= MAX_RESUMES + 2; deploy++) {
      const next = color();
      expect(await next.registerResume(id), `deploy ${deploy}: resume`).toBe(true);
      expect((await state(id)).count, `deploy ${deploy}: counted while the old color holds the lease`).toBeGreaterThan(0);
      await serving.stop(50); // the in-flight request outlives the wait: the lease is released anyway
      const s = await state(id);
      expect(s.status, `deploy ${deploy}`).toBe('RUNNING');
      expect(s.owner, `deploy ${deploy}: lease released`).toBeNull();
      expect(s.count, `deploy ${deploy}: the clean release undid the resume`).toBe(0);
      clock.advance(60_000);
      serving = next;
      await advancingMidRequest(serving, id); // the new color takes over at once (no lease to wait for)
    }
    expect((await state(id)).status).toBe('RUNNING');
  });

  // (a), the plain restart: the old process stops before the new one starts.
  test('gracefulRestartWithoutOverlapIsNotCounted', async () => {
    const id = await startRun();
    for (let restart = 1; restart <= MAX_RESUMES + 2; restart++) {
      const old = color();
      await advancingMidRequest(old, id);
      old.beginStop();
      await old.stop(50);
      expect((await state(id)).owner).toBeNull();
      expect(await color().registerResume(id), `restart ${restart}`).toBe(true);
      expect((await state(id)).count, `restart ${restart}`).toBe(0);
    }
    expect((await state(id)).status).toBe('RUNNING');
  });

  // A stop lets the in-flight answer land (paid work recorded), sends nothing new, keeps the
  // sync job open, and the next color finishes the run without re-sending what was answered.
  test('stopRecordsTheInFlightAnswerAndTheNextColorResumesTheOpenJob', async () => {
    const id = await startRun();
    const old = color();
    await advancingMidRequest(old, id);
    const next = color();
    expect(await next.registerResume(id)).toBe(true);
    old.beginStop();
    gate.release();
    await old.stop();
    const sent = a.fakeSync().received().length;
    expect(sent).toBe(1);
    const done = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE run_id = ${id}::uuid AND status = 'DONE'`);
    expect(done).toBe(1);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_llm_usage WHERE run_id = ${id}::uuid`)).toBe(1);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE run_id = ${id}::uuid AND status = 'SUBMITTED'`)).toBeGreaterThan(0);
    expect((await a.sql`SELECT status FROM wiki.kb_batch_job WHERE run_id = ${id}::uuid`).map((r) => r.status)).toEqual(['SUBMITTED']);
    const s = await state(id);
    expect([s.owner, s.count, s.status]).toEqual([null, 0, 'RUNNING']);
    expect(await next.advance(id)).toBe(true);
    expect((await a.get(id)).status).toBe('SUCCEEDED');
    const requests = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE run_id = ${id}::uuid`);
    expect(a.fakeSync().received().length, 'no request was sent twice').toBe(requests);
  });

  // Any release by the holder proves it was alive while it held the lease: resumes counted
  // meanwhile (by a color starting next to it) are undone, earlier ones are kept.
  test('releaseRestoresTheCountFromWhenTheLeaseWasTaken', async () => {
    const id = await startRun();
    const db = a.t.deps.db;
    const now = () => nowOf(a.t.deps)();
    const until = () => now().plusSeconds(LEASE_MS / 1000);
    const count = () => inTx(db, () => runs.countResume(id, now(), now().plusMinutes(-30)));
    await count(); // one genuine crash before the holder took the run
    expect(await inTx(db, () => runs.takeLease(id, 'holder', until(), now()))).toBe(1);
    const kept = (await inTx(db, () => runs.leaseState(id, now())))!;
    expect([kept.owner, kept.live, kept.count]).toEqual(['holder', true, 1]);
    await count(); // a color starting while the holder is alive
    await count();
    expect(await inTx(db, () => runs.releaseLease(id, 'someone-else', kept))).toBe(0);
    expect((await state(id)).count).toBe(3);
    expect(await inTx(db, () => runs.releaseLease(id, 'holder', kept))).toBe(1);
    expect((await state(id)).count).toBe(1);
    // The window rolled over while the lease was held: every count in the new window is undone.
    expect(await inTx(db, () => runs.takeLease(id, 'holder2', until(), now()))).toBe(1);
    const kept2 = (await inTx(db, () => runs.leaseState(id, now())))!;
    clock.advance(31 * 60_000);
    await count();
    expect(await inTx(db, () => runs.releaseLease(id, 'holder2', kept2))).toBe(1);
    const [r] = await a.sql`SELECT resume_count, resume_window_start FROM wiki.kb_run WHERE id = ${id}::uuid`;
    expect([Number(r!.resume_count), r!.resume_window_start]).toEqual([0, null]);
  });

  // (b) The holder died (OOM kill): its lease is left behind. Startups count; the one past
  // MAX_RESUMES fails the run, at startup when the dead lease already expired, else when
  // the lease is taken over (a live lease may belong to a color that is still running).
  test('uncleanRestartsStillFailTheRun', async () => {
    const id = await startRun();
    for (let restart = 1; restart <= MAX_RESUMES; restart++) {
      await crashedHolder(id);
      clock.advance(10_000);
      expect(await color().registerResume(id), `restart ${restart}`).toBe(true);
      expect((await state(id)).count).toBe(restart);
      clock.advance(LEASE_MS); // the dead lease expires; the restarted process takes it over and dies too
    }
    await crashedHolder(id);
    clock.advance(10_000);
    const last = color();
    expect(await last.registerResume(id)).toBe(true); // the lease is still live: decided at takeover
    expect((await state(id)).status).toBe('RUNNING');
    clock.advance(LEASE_MS);
    expect(await last.advance(id)).toBe(true);
    const s = await state(id);
    expect(s.status).toBe('FAILED');
    expect(s.error).toBe(`${RESUME_LOOP_ERROR} (DETECT)`);
    expect(s.owner).toBeNull();
    expect(a.fakeSync().received()).toHaveLength(0);
  });

  test('uncleanRestartPastTheLimitWithAnExpiredLeaseFailsAtStartup', async () => {
    const id = await startRun();
    for (let restart = 1; restart <= MAX_RESUMES; restart++) {
      await crashedHolder(id);
      clock.advance(LEASE_MS + 10_000);
      expect(await color().registerResume(id)).toBe(true);
    }
    await crashedHolder(id);
    clock.advance(LEASE_MS + 10_000);
    expect(await color().registerResume(id)).toBe(false);
    expect((await state(id)).status).toBe('FAILED');
    expect((await a.get(id)).error).toContain('detenida tras reinicios repetidos');
  });

  // (c) After a clean blue/green handoff the new color crash-loops: the old color's
  // release happened before, under its own token, so every crash after it counts.
  test('cleanHandoffDoesNotHideACrashLoopAfterIt', async () => {
    const id = await startRun();
    const blue = color();
    await advancingMidRequest(blue, id);
    const green = color();
    expect(await green.registerResume(id)).toBe(true);
    await blue.stop(50);
    expect((await state(id)).count).toBe(0);
    // green takes the run and dies mid-request (no shutdown hooks): its lease stays.
    await advancingMidRequest(green, id);
    expect((await state(id)).owner).not.toBeNull();
    await blue.stop(50); // the old color stopping again (or late) cannot touch green's lease
    for (let restart = 1; restart <= MAX_RESUMES; restart++) {
      clock.advance(10_000);
      expect(await color().registerResume(id), `restart ${restart}`).toBe(true);
      expect((await state(id)).count).toBe(restart);
      clock.advance(LEASE_MS);
      await crashedHolder(id); // the restarted process took over and died too
    }
    clock.advance(LEASE_MS + 10_000);
    expect(await color().registerResume(id)).toBe(false);
    expect((await state(id)).status).toBe('FAILED');
  });

  // An idle RUNNING run (nobody held its lease when the process stopped) is not counted.
  test('aRunNobodyWasAdvancingIsNotCounted', async () => {
    const id = await startRun();
    for (let i = 0; i <= MAX_RESUMES + 1; i++) expect(await color().registerResume(id)).toBe(true);
    expect((await state(id)).count).toBe(0);
  });
});
