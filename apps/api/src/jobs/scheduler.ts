// The @Scheduled equivalent. Every src/features/<area>/jobs.ts default-exports
// `defineJobs((deps) => [...])`; the scheduler discovers them, so features
// never edit this file. Semantics:
//   cron         Spring 6-field cron (sec min hour dom mon dow, names like SUN/MON),
//                in `zone` or, without one, the JVM default zone (TZ, ART in prod);
//                day-of-month AND day-of-week must both match (Spring);
//   fixedDelayMs next run starts this long after the previous one FINISHED
//                (first after initialDelayMs, default 0);
//   fixedRateMs  runs every period from start (skips a tick while still running,
//                like Spring's single thread per job).
// A job with `lock` runs through JobLock.runExclusively (mandatory for new jobs,
// with a new id in JOBS). Graceful shutdown stops new runs and waits for running
// ones (spring.task.scheduling.shutdown.await-termination-period, 30 s).
//
// Lifecycle hooks (a jobs.ts may return `{ jobs, startup, shutdown }` instead of
// an array), run by main.ts in Spring's order:
//   startup   @EventListener(ApplicationReadyEvent): after the scheduler started,
//             one after the other by `order`, while readiness still answers 503
//             (Spring publishes ACCEPTING_TRAFFIC only after these listeners
//             return). A hook that throws fails the startup, as in Spring.
//   shutdown  phase 'closing'   = @EventListener(ContextClosedEvent): right after
//             readiness goes down, before the drain (stop flags);
//             phase 'executors' = applicationTaskExecutor's await-termination
//             (spring.task.execution.shutdown, 60 s): after HTTP and the
//             scheduler stopped, before the pool closes (drain kicked workers).

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import type { Deps } from '../deps';
import type { JobName } from './joblock';

export type JobSchedule =
  | { cron: string; zone?: string }
  | { fixedDelayMs: number; initialDelayMs?: number }
  | { fixedRateMs: number; initialDelayMs?: number };

export interface JobDefinition {
  /** Java `Class#method` it ports, for logs. */
  name: string;
  /** JobLock id; omit only for jobs Java runs without a lock (OrgMailJob.tick). */
  lock?: JobName;
  schedule: JobSchedule;
  /** Like the @ConditionalOnProperty / *.jobs-enabled flags. */
  enabled: boolean;
  run(): Promise<void>;
}

export interface StartupHook {
  /** Java `Class#method`, for logs. */
  name: string;
  /** Listener order (Java: bean registration order of the @EventListener beans). */
  order: number;
  enabled: boolean;
  run(): Promise<unknown>;
}

export interface ShutdownHook {
  name: string;
  phase: 'closing' | 'executors';
  order: number;
  run(): Promise<unknown> | void;
}

export interface FeatureJobs {
  jobs?: JobDefinition[];
  startup?: StartupHook[];
  shutdown?: ShutdownHook[];
}

export type JobsModule = (deps: Deps) => JobDefinition[] | FeatureJobs | Promise<JobDefinition[] | FeatureJobs>;
export const defineJobs = (fn: JobsModule): JobsModule => fn;

export interface Discovered {
  jobs: JobDefinition[];
  startup: StartupHook[];
  shutdown: ShutdownHook[];
}

/** One jobs.ts module's result as `{ jobs, startup, shutdown }` (an array is jobs only). */
export async function featureJobs(mod: JobsModule, deps: Deps): Promise<Discovered> {
  const r = await mod(deps);
  return Array.isArray(r) ? { jobs: r, startup: [], shutdown: [] } : { jobs: r.jobs ?? [], startup: r.startup ?? [], shutdown: r.shutdown ?? [] };
}

/** Every feature's jobs and lifecycle hooks (hooks sorted by order). */
export async function discoverLifecycle(deps: Deps, featuresDir = FEATURES_DIR): Promise<Discovered> {
  const out: Discovered = { jobs: [], startup: [], shutdown: [] };
  if (!existsSync(featuresDir)) return out;
  for (const area of readdirSync(featuresDir).sort()) {
    const file = join(featuresDir, area, 'jobs.ts');
    if (!existsSync(file)) continue;
    const mod = (await import(file)) as { default?: JobsModule };
    if (typeof mod.default !== 'function') throw new Error(`src/features/${area}/jobs.ts must default-export defineJobs(...)`);
    const r = await featureJobs(mod.default, deps);
    out.jobs.push(...r.jobs);
    out.startup.push(...r.startup);
    out.shutdown.push(...r.shutdown);
  }
  out.startup.sort((a, b) => a.order - b.order);
  out.shutdown.sort((a, b) => a.order - b.order);
  return out;
}

/** Runs the enabled startup hooks in order; the first failure propagates. */
export async function runStartupHooks(deps: Deps, hooks: StartupHook[]): Promise<void> {
  for (const h of hooks.filter((x) => x.enabled)) {
    deps.log.debug(`Startup: ${h.name}`);
    await h.run();
  }
}

/** Runs the shutdown hooks of one phase in order (each failure is logged), bounded by timeoutMs. */
export async function runShutdownHooks(deps: Deps, hooks: ShutdownHook[], phase: ShutdownHook['phase'], timeoutMs: number): Promise<void> {
  const run = (async () => {
    for (const h of hooks.filter((x) => x.phase === phase)) {
      try {
        await h.run();
      } catch (e) {
        deps.log.warn({ err: e }, `Shutdown hook ${h.name} failed`);
      }
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([run, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
  clearTimeout(timer);
}

const FEATURES_DIR = join(import.meta.dir, '..', 'features');

export async function discoverJobs(deps: Deps, featuresDir = FEATURES_DIR): Promise<JobDefinition[]> {
  return (await discoverLifecycle(deps, featuresDir)).jobs;
}

export class JobScheduler {
  private readonly crons: Cron[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;

  constructor(private readonly deps: Deps, private readonly jobs: JobDefinition[]) {}

  start(): void {
    const log = this.deps.log.child({ component: 'scheduler' });
    for (const job of this.jobs.filter((j) => j.enabled)) {
      const s = job.schedule;
      if ('cron' in s) {
        this.crons.push(new Cron(s.cron, { timezone: s.zone ?? this.deps.config.server.timeZone, domAndDow: true, protect: true }, () => this.fire(job)));
      } else if ('fixedDelayMs' in s) {
        const loop = (delay: number) => {
          if (this.stopped) return;
          const t = setTimeout(async () => {
            this.timers.delete(t);
            await this.fire(job);
            loop(s.fixedDelayMs);
          }, delay);
          this.timers.add(t);
        };
        loop(s.initialDelayMs ?? 0);
      } else {
        let busy = false;
        const tick = async () => {
          if (busy || this.stopped) return;
          busy = true;
          try { await this.fire(job); } finally { busy = false; }
        };
        const t = setTimeout(() => {
          this.timers.delete(t);
          void tick();
          const i = setInterval(() => void tick(), s.fixedRateMs);
          this.timers.add(i as unknown as ReturnType<typeof setTimeout>);
        }, s.initialDelayMs ?? 0);
        this.timers.add(t);
      }
      log.info(`Scheduled ${job.name} (${JSON.stringify(s)})`);
    }
  }

  private async fire(job: JobDefinition): Promise<void> {
    if (this.stopped) return;
    const run = (async () => {
      try {
        if (job.lock) await this.deps.jobLock.runExclusively(job.lock, () => job.run());
        else await job.run();
      } catch (e) {
        this.deps.log.error({ err: e }, `Job ${job.name} failed`);
      }
    })();
    this.running.add(run);
    try { await run; } finally { this.running.delete(run); }
  }

  /** Stops scheduling and waits (up to timeoutMs) for running jobs. */
  async stop(timeoutMs: number): Promise<void> {
    this.stopped = true;
    for (const c of this.crons) c.stop();
    for (const t of this.timers) { clearTimeout(t); clearInterval(t as unknown as ReturnType<typeof setInterval>); }
    this.timers.clear();
    if (this.running.size === 0) return;
    await Promise.race([Promise.allSettled([...this.running]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}
