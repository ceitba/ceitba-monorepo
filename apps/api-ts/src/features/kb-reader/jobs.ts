// scheduling/KbRelationJob + scheduling/KbEmbeddingJob.
//
// KbRelationJob (JobLock KB_RELATIONS, id 4): on startup (ApplicationReadyEvent)
// and nightly at 04:30 in the JVM zone: refresh the related subjects, then expire
// the pipeline's stored payloads (KbRunRetentionService, kb-pipeline's
// `retention.purgeExpired()`). Spring publishes ReadinessState.ACCEPTING_TRAFFIC only
// after the ApplicationReadyEvent listeners return, so the startup run starts when
// the jobs are discovered (main.ts, right before the scheduler starts) and holds
// readiness (/actuator/health/readiness 503) until it is done; otherwise a client
// that waits for readiness (the contract harness) races the refresh's DELETE/INSERT.
//
// KbEmbeddingJob (KB_EMBEDDINGS, id 5): a sweep a minute after startup and then
// every kb.embeddings.interval; off with kb.embeddings.enabled=false (tests).

import type { Deps } from '../../deps';
import { defineJobs } from '../../jobs/scheduler';
import { isModuleNotFound, kbReader } from './services';

const KB_PIPELINE_SERVICE = '../kb-pipeline/service';
const started = new WeakSet<Deps>();

async function expireRunPayloads(deps: Deps): Promise<void> {
  type Retention = { expire?: () => Promise<unknown>; purgeExpired?: () => Promise<unknown> };
  let pipeline: { kbPipeline?: (d: Deps) => { retention?: Retention } };
  try {
    pipeline = await import(KB_PIPELINE_SERVICE);
  } catch (e) {
    if (isModuleNotFound(e)) return;   // kb-pipeline not ported yet
    throw e;
  }
  const r = pipeline.kbPipeline?.(deps).retention;
  await (r?.expire ?? r?.purgeExpired)?.call(r);
}

export default defineJobs((deps) => {
  const log = deps.log.child({ component: 'KbRelationJob' });
  const relationRun = async () => {
    try {
      log.info(`KB subject relations refreshed: ${await kbReader(deps).relations.refresh()} prerequisite pairs`);
    } catch (e) {
      log.warn(`KB subject relation refresh failed: ${(e as Error).message}`);
    }
    try {
      await expireRunPayloads(deps);
    } catch (e) {
      log.warn(`KB run retention failed: ${(e as Error).message}`);
    }
  };
  if (!started.has(deps)) {
    // @EventListener(ApplicationReadyEvent.class) run().
    started.add(deps);
    const availability = deps.availability;
    const held = availability.acceptingTraffic;
    availability.acceptingTraffic = false;
    void deps.jobLock.runExclusively('KB_RELATIONS', relationRun)
      .catch((e) => log.warn(`KB subject relation refresh failed: ${(e as Error).message}`))
      .finally(() => { if (held) availability.acceptingTraffic = true; });
  }
  const embedLog = deps.log.child({ component: 'KbEmbeddingJob' });
  return [
    {
      name: 'KbRelationJob#run',
      lock: 'KB_RELATIONS',
      schedule: { cron: '0 30 4 * * *' },
      enabled: true,
      run: relationRun,
    },
    {
      name: 'KbEmbeddingJob#run',
      lock: 'KB_EMBEDDINGS',
      schedule: { fixedDelayMs: deps.config.kb.embeddings.intervalMs, initialDelayMs: 60_000 },
      enabled: deps.config.kb.embeddings.enabled,
      run: async () => {
        try {
          await kbReader(deps).embeddings.embedPending();
        } catch (e) {
          embedLog.warn(`KB embedding sweep failed: ${(e as Error).message}`);
        }
      },
    },
  ];
});
