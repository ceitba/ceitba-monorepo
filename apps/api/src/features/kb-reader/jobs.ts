// scheduling/KbRelationJob + scheduling/KbEmbeddingJob.
//
// KbRelationJob (JobLock KB_RELATIONS, id 4): on startup (ApplicationReadyEvent)
// and nightly at 04:30 in the JVM zone: refresh the related subjects, then expire
// the pipeline's stored payloads (KbRunRetentionService, kb-pipeline's
// `retention.purgeExpired()`). The startup run is a startup hook: Spring publishes
// ReadinessState.ACCEPTING_TRAFFIC only after the ApplicationReadyEvent listeners
// return, so a client that waits for readiness (the contract harness) never races
// the refresh's DELETE/INSERT.
//
// KbEmbeddingJob (KB_EMBEDDINGS, id 5): a sweep a minute after startup and then
// every kb.embeddings.interval; off with kb.embeddings.enabled=false (tests).

import type { Deps } from '../../deps';
import { defineJobs } from '../../jobs/scheduler';
import { kbPipeline } from '../kb-pipeline/service';
import { kbReader } from './services';

async function expireRunPayloads(deps: Deps): Promise<void> {
  await kbPipeline(deps).retention.purgeExpired();
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
  const embedLog = deps.log.child({ component: 'KbEmbeddingJob' });
  return {
    // @EventListener(ApplicationReadyEvent.class) run().
    startup: [{
      name: 'KbRelationJob#run', order: 30, enabled: true,
      run: () => deps.jobLock.runExclusively('KB_RELATIONS', relationRun),
    }],
    jobs: [
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
    ],
  };
});
