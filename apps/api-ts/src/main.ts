// Boot: config -> Flyway-compatible migrate (spring.flyway.enabled) -> db ->
// HTTP on PORT (context path /api) -> scheduled jobs. SIGTERM/SIGINT:
// readiness goes OUT_OF_SERVICE, keep serving SHUTDOWN_DRAIN (blue/green,
// config/ShutdownDrain), then a graceful stop (in-flight requests finish, up
// to 60 s), then jobs (up to 30 s), then the pool.

import postgres from 'postgres';
import { loadConfig, type Config } from './config';
import { migrate } from './db/migrate';
import { buildDeps, type Deps, type DepsOverrides } from './deps';
import { createApp, type App } from './http/app';
import { createLogger } from './infra/logger';
import { discoverJobs, JobScheduler } from './jobs/scheduler';

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
  const server = Bun.serve({
    port: config.server.port,
    // Dual stack, like Tomcat: the image's health check hits localhost (::1 on alpine).
    hostname: '::',
    idleTimeout: 120,
    // Bodies are read by the route wrapper; Tomcat's default max POST size does not apply to JSON.
    maxRequestBodySize: 64 * 1024 * 1024,
    fetch: (req, srv) => app.fetch(req, srv),
  });
  const scheduler = new JobScheduler(deps, opts.jobs === false ? [] : await discoverJobs(deps));
  scheduler.start();
  log.info(`ceitba-api-ts started on port ${server.port} with context path '/api' (${app.routes.length} routes)`);

  let stopping: Promise<void> | null = null;
  const shutdown = (reason = 'shutdown') => {
    stopping ??= (async () => {
      deps.availability.acceptingTraffic = false;
      const drain = config.server.shutdownDrainMs;
      if (drain > 0) {
        log.info(`Shutting down: refusing traffic and draining for ${Math.floor(drain / 1000)}s`);
        await Bun.sleep(drain);
      }
      log.info(`Stopping (${reason}): waiting for in-flight requests`);
      await Promise.race([server.stop(false), Bun.sleep(config.server.shutdownTimeoutMs)]);
      server.stop(true);
      await scheduler.stop(config.server.jobsShutdownTimeoutMs);
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
