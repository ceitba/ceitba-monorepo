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
//   - at startup (ApplicationReadyEvent hook, after DigestJob's): the "Básico" eval
//     set (KbEvalService.ensureDefaultSet, kb-admin; not caught, as in Java), then
//     resumes every active run a restart interrupted, counting the resumes of
//     RUNNING ones (more than 3 in 30 minutes: the run is FAILED);
//   - on shutdown: no new work from SIGTERM on ('closing'), then, with the task executor, running
//     advances finish and release their leases (after STOP_WAIT_MS they are released anyway).
// All but the shutdown off with kb.pipeline.background=false (tests drive the engine).

import { defineJobs } from '../../jobs/scheduler';
import { ART_ZONE } from '../kb/logic/odt';
import { jobs as jobRepo } from './db/repo';
import { inTx } from './db/session';
import { kbAdmin } from '../kb-admin/service';
import { kbCollaborators, kbPipeline, nowOf } from './service';

export default defineJobs((deps) => {
  const background = deps.config.kb.pipeline.background;
  const log = deps.log.child({ component: 'KbPipelineJob' });
  const kb = () => kbPipeline(deps);
  return {
    jobs: [
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
          await kbCollaborators(deps).catalog?.refreshPendingProbes?.();
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
    ],
    startup: [{
      name: 'KbPipelineJob#onStartup', order: 20, enabled: background,
      async run() {
        await kbAdmin(deps).evals.ensureDefaultSet();
        try {
          const k = kb();
          for (const id of await k.engine.activeRunIds()) {
            if (await k.engine.registerResume(id)) k.engine.kick(id);
          }
        } catch (e) {
          log.warn(`KB startup resume failed: ${(e as Error).message}`);
        }
      },
    }],
    // The engine's advances run on the task executor whether or not this bean exists. On SIGTERM the
    // engine stops starting work at once ('closing': in-flight sync requests finish and are recorded),
    // then waits for its advances and releases their leases ('executors'), so the next process does
    // not count the stop as a crash (docs/SUBJECT-WIKI-PIPELINE.md "Restart-loop guard").
    shutdown: [
      { name: 'KbRunEngine#onShutdown', phase: 'closing', order: 30, run: () => kb().engine.beginStop() },
      { name: 'KbRunEngine (task executor)', phase: 'executors', order: 30, run: () => kb().engine.stop() },
    ],
  };
});
