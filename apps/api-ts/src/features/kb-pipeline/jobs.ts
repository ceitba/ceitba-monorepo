// Port of apps/api/src/main/java/org/ceitba/api/scheduling/KbPipelineJob.java (background side
// of the wiki pipeline, docs/SUBJECT-WIKI-PIPELINE.md "Orchestration"):
//   - kick: a run/eval created, approved or resumed is advanced at once
//     (KbRunEngine.triggered/kick, one task per run);
//   - batch poller (JobLock 10), every KB_BATCH_POLL_INTERVAL (PT1M, first after 30 s):
//     runs with a SUBMITTED DO batch or a due QUEUED one, sync runs whose daily-quota
//     pause is over, and pending batch probes (the catalog's, when registered);
//   - safety sweep (JobLock 11), every KB_POLL_INTERVAL (PT10M, first after one interval):
//     kicks every active run;
//   - every minute (JobLock 12, cron "0 * * * * *" in ART): the weekly schedule;
//   - at startup: resumes every active run a restart interrupted, counting the
//     resumes of RUNNING ones (more than 3 in 30 minutes: the run is FAILED).
// All off with kb.pipeline.background=false (tests drive the engine).

import { defineJobs } from '../../jobs/scheduler';
import { ART_ZONE } from '../kb/logic/odt';
import { collaborators } from './collaborators';
import { jobs as jobRepo } from './db/repo';
import { inTx } from './db/session';
import { kbPipeline, nowOf } from './service';

export default defineJobs((deps) => {
  const background = deps.config.kb.pipeline.background;
  const log = deps.log.child({ component: 'KbPipelineJob' });
  const kb = () => kbPipeline(deps);
  let started = false;
  return [
    {
      name: 'KbPipelineJob#pollBatches',
      lock: 'KB_PIPELINE_BATCHES',
      enabled: background,
      schedule: { fixedDelayMs: deps.config.kb.pipeline.batchPollIntervalMs, initialDelayMs: 30_000 },
      async run() {
        const k = kb();
        try {
          const now = nowOf(deps)();
          for (const id of await inTx(deps.db, () => jobRepo.runsWithOpenBatches(now))) k.engine.kick(id);
          for (const id of k.engine.quotaResumeDue()) k.engine.kick(id); // sync runs paused on the daily token quota
        } catch (e) {
          log.warn(`KB batch poll failed: ${(e as Error).message}`);
        }
        try {
          await collaborators(deps).catalog?.refreshPendingProbes?.();
        } catch (e) {
          log.warn(`KB probe refresh failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'KbPipelineJob#sweep',
      lock: 'KB_PIPELINE_POLL',
      enabled: background,
      schedule: { fixedDelayMs: deps.config.kb.pipeline.pollIntervalMs, initialDelayMs: deps.config.kb.pipeline.pollIntervalMs },
      async run() {
        try {
          for (const id of await kb().engine.activeRunIds()) kb().engine.kick(id);
        } catch (e) {
          log.warn(`KB pipeline sweep failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'KbPipelineJob#tick',
      lock: 'KB_PIPELINE_SCHEDULE',
      enabled: background,
      schedule: { cron: '0 * * * * *', zone: ART_ZONE },
      async run() {
        try {
          await kb().pipeline.schedulerTick();
        } catch (e) {
          log.warn(`KB pipeline scheduler tick failed: ${(e as Error).message}`);
        }
      },
    },
    {
      // @EventListener(ApplicationReadyEvent): once, right after startup (no JobLock in Java).
      name: 'KbPipelineJob#onStartup',
      enabled: background,
      schedule: { fixedDelayMs: 24 * 3600_000, initialDelayMs: 0 },
      async run() {
        if (started) return;
        started = true;
        try {
          await collaborators(deps).evals?.ensureDefaultSet();
        } catch (e) {
          log.warn(`KB default eval set not ensured: ${(e as Error).message}`);
        }
        try {
          const k = kb();
          for (const id of await k.engine.activeRunIds()) {
            if (await k.engine.registerResume(id)) k.engine.kick(id);
          }
        } catch (e) {
          log.warn(`KB startup resume failed: ${(e as Error).message}`);
        }
      },
    },
  ];
});
