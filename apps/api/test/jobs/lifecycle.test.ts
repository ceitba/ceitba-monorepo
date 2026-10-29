// The startup and shutdown hooks (src/jobs/scheduler.ts, run by main.ts), in
// Spring's order: ApplicationReadyEvent listeners one after the other while
// readiness is still down (DigestJob, KbPipelineJob, KbRelationJob, OrgMailJob);
// on close the ContextClosedEvent stop flags before the drain, the task executor
// drains (digest/orgmail workers, the KB run engine) after HTTP and the jobs.
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { cloneDatabase, dropDatabase, jdbcParts, pgServerUrl, withDatabase } from '../../contract/support/pg';
import { loadConfig } from '../../src/config';
import { buildDeps } from '../../src/deps';
import { silentLogger } from '../../src/infra/logger';
import { discoverLifecycle, runShutdownHooks, runStartupHooks, type ShutdownHook, type StartupHook } from '../../src/jobs/scheduler';
import { start } from '../../src/main';

const deps = { log: silentLogger } as never;

describe('lifecycle hooks', () => {
  test('startupHooksRunInOrderAndAFailureStopsTheStartup', async () => {
    const seen: string[] = [];
    const hook = (name: string, order: number, enabled = true, fail = false): StartupHook => ({
      name, order, enabled, run: async () => { await Bun.sleep(1); seen.push(name); if (fail) throw new Error(name); },
    });
    await runStartupHooks(deps, [hook('a', 1), hook('off', 2, false), hook('b', 3)]);
    expect(seen).toEqual(['a', 'b']);
    seen.length = 0;
    await expect(runStartupHooks(deps, [hook('x', 1, true, true), hook('y', 2)])).rejects.toThrow('x');
    expect(seen).toEqual(['x']);
  });

  test('shutdownHooksRunByPhaseAndAFailureDoesNotStopTheOthers', async () => {
    const seen: string[] = [];
    const hook = (name: string, phase: ShutdownHook['phase'], fail = false): ShutdownHook => ({
      name, phase, order: 0, run: () => { seen.push(name); if (fail) throw new Error(name); },
    });
    const hooks = [hook('flag', 'closing', true), hook('flag2', 'closing'), hook('drain', 'executors')];
    await runShutdownHooks(deps, hooks, 'closing', 1000);
    expect(seen).toEqual(['flag', 'flag2']);
    await runShutdownHooks(deps, hooks, 'executors', 1000);
    expect(seen).toEqual(['flag', 'flag2', 'drain']);
    // Bounded like await-termination-period.
    const slow: ShutdownHook = { name: 'slow', phase: 'executors', order: 0, run: () => new Promise(() => {}) };
    const t0 = Date.now();
    await runShutdownHooks(deps, [slow], 'executors', 50);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('theFeaturesRegisterJavasListenersInJavasOrder', async () => {
    const config = await loadConfig({
      ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x',
      DIGEST_JOBS_ENABLED: 'true', ORG_MAIL_JOBS_ENABLED: 'true', KB_PIPELINE_BACKGROUND: 'true',
    });
    const d = await buildDeps(config, { log: silentLogger, push: null });
    try {
      const l = await discoverLifecycle(d);
      expect(l.startup.map((h) => [h.name, h.enabled])).toEqual([
        ['DigestJob#onStartup', true], ['KbPipelineJob#onStartup', true], ['KbRelationJob#run', true], ['OrgMailJob#onStartup', true],
      ]);
      const phase = (p: string) => l.shutdown.filter((h) => h.phase === p).map((h) => h.name);
      // KbRunEngine#onShutdown is TS-only: the engine stops starting work on SIGTERM (docs/SUBJECT-WIKI-PIPELINE.md).
      expect(phase('closing')).toEqual(['DigestSender#onShutdown', 'OrgAnnouncementSender#onShutdown', 'KbRunEngine#onShutdown']);
      expect(phase('executors')).toEqual(['DigestSender (task executor)', 'OrgAnnouncementSender (task executor)', 'KbRunEngine (task executor)']);
      // Without the background flags the listeners' beans do not exist (the KB relation refresh always runs).
      const off = await discoverLifecycle(await buildDeps(await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x' }), { log: silentLogger, push: null }));
      expect(off.startup.filter((h) => h.enabled).map((h) => h.name)).toEqual(['KbRelationJob#run']);
    } finally {
      await d.close();
    }
  });

  test('readinessStaysDownUntilTheStartupHooksReturn', async () => {
    const db = await cloneDatabase('lc');
    const { jdbc, user, password } = jdbcParts(withDatabase(await pgServerUrl(), db));
    const s = await start({
      env: { ...CONTRACT_ENV, DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password, PORT: '0' },
      overrides: { log: silentLogger },
    });
    try {
      // start() resolves only after the hooks: readiness is up, and the relation refresh already ran.
      expect((await fetch(`${s.url}/api/actuator/health/readiness`)).status).toBe(200);
      expect(s.deps.availability.acceptingTraffic).toBe(true);
    } finally {
      await s.shutdown('test');
      await dropDatabase(db);
    }
  }, 60_000);
});
