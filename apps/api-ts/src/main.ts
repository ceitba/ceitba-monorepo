// Boot: config -> Flyway-compatible migrate (spring.flyway.enabled) -> db ->
// HTTP on PORT (context path /api, readiness 503) -> scheduled jobs -> the
// startup hooks (ApplicationReadyEvent, in order) -> readiness UP.
// SIGTERM/SIGINT: readiness goes OUT_OF_SERVICE, the 'closing' hooks
// (ContextClosedEvent: stop flags), keep serving SHUTDOWN_DRAIN (blue/green,
// config/ShutdownDrain), then a graceful stop (in-flight requests finish, up
// to 60 s), then jobs (up to 30 s), then the 'executors' hooks (kicked
// workers finish, up to 60 s), then the pool.

import postgres from 'postgres';
import { loadConfig, type Config } from './config';
import { migrate } from './db/migrate';
import { buildDeps, type Deps, type DepsOverrides } from './deps';
import { createApp, type App } from './http/app';
import { createLogger } from './infra/logger';
import { discoverLifecycle, JobScheduler, runShutdownHooks, runStartupHooks, type Discovered } from './jobs/scheduler';

export interface RunningServer {
  url: string;
  port: number;
  app: App;
  deps: Deps;
  /** Graceful shutdown (drain, stop HTTP, jobs, pool). */
  shutdown(reason?: string): Promise<void>;
}

export async function runMigrations(config: Config, log = createLogger(config)): Promise<void> {
  const f = config.db.flyway;
  const sql = postgres(config.db.url, { max: 1, onnotice: () => {}, connection: { TimeZone: config.server.timeZone, application_name: 'ceitba-api-ts migrate' } });
  try {
    const r = await migrate(sql, {
      locations: f.locations, schemas: f.schemas, defaultSchema: f.defaultSchema, target: f.target,
      outOfOrder: f.outOfOrder, baselineOnMigrate: f.baselineOnMigrate, baselineVersion: f.baselineVersion,
      log: (m) => log.info(m),
    });
    log.info(`Flyway-compatible migrate: ${r.applied.length} applied, schema version ${r.schemaVersion}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function start(opts: { env?: Record<string, string | undefined>; overrides?: DepsOverrides; jobs?: boolean } = {}): Promise<RunningServer> {
  const config = await loadConfig(opts.env ?? process.env);
  const log = opts.overrides?.log ?? createLogger(config);
  if (config.db.flyway.enabled) await runMigrations(config, log);
  const deps = await buildDeps(config, { ...opts.overrides, log });
  const app = await createApp(deps);
  // Spring publishes ReadinessState.ACCEPTING_TRAFFIC only after the ApplicationReadyEvent listeners.
  deps.availability.acceptingTraffic = false;
  const server = Bun.serve({
    port: config.server.port,
    // Dual stack, like Tomcat: the image's health check hits localhost (::1 on alpine).
    hostname: '::',
    idleTimeout: 120,
    // Bodies are read by the route wrapper; Tomcat's default max POST size does not apply to JSON.
    maxRequestBodySize: 64 * 1024 * 1024,
    fetch: (req, srv) => app.fetch(req, srv),
  });
  const lifecycle: Discovered = opts.jobs === false ? { jobs: [], startup: [], shutdown: [] } : await discoverLifecycle(deps);
  const scheduler = new JobScheduler(deps, lifecycle.jobs);
  scheduler.start();
  try {
    await runStartupHooks(deps, lifecycle.startup);
  } catch (e) {
    log.error({ err: e }, 'Application run failed');
    server.stop(true);
    await scheduler.stop(config.server.jobsShutdownTimeoutMs);
    await deps.close();
    throw e;
  }
  deps.availability.acceptingTraffic = true;
  log.info(`ceitba-api-ts started on port ${server.port} with context path '/api' (${app.routes.length} routes)`);

  let stopping: Promise<void> | null = null;
  const shutdown = (reason = 'shutdown') => {
    stopping ??= (async () => {
      deps.availability.acceptingTraffic = false;
      await runShutdownHooks(deps, lifecycle.shutdown, 'closing', config.server.shutdownTimeoutMs);
      const drain = config.server.shutdownDrainMs;
      if (drain > 0) {
        log.info(`Shutting down: refusing traffic and draining for ${Math.floor(drain / 1000)}s`);
        await Bun.sleep(drain);
      }
      log.info(`Stopping (${reason}): waiting for in-flight requests`);
      await Promise.race([server.stop(false), Bun.sleep(config.server.shutdownTimeoutMs)]);
      server.stop(true);
      await scheduler.stop(config.server.jobsShutdownTimeoutMs);
      await runShutdownHooks(deps, lifecycle.shutdown, 'executors', config.server.tasksShutdownTimeoutMs);
      await deps.close();
      log.info('Stopped');
    })();
    return stopping;
  };
  return { url: `http://localhost:${server.port}`, port: server.port!, app, deps, shutdown };
}

if (import.meta.main) {
  const running = await start();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      void running.shutdown(sig).then(() => process.exit(0));
    });
  }
}
