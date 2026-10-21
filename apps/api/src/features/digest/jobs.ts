// scheduling/DigestJob (off with DIGEST_JOBS_ENABLED=false):
//   - Monday 00:05 ART: the draft for the week that just ended (JobLock 6, DIGEST_SCHEDULE)
//   - every DIGEST_TICK_INTERVAL (initial 1 min): the same draft as a catch-up (nested
//     DIGEST_SCHEDULE lock), start due auto-sends, kick the worker (JobLock 7, DIGEST_TICK)
//   - ApplicationReadyEvent: the draft + the worker (startup hook, first listener).
// The worker (DigestSender) runs detached from the tick ("task executor"). On
// shutdown its stop flag is set at ContextClosedEvent (always: DigestSender is a
// bean even with the jobs off) and the kicked runs are awaited with the executor.
import { defineJobs } from '../../jobs/scheduler';
import { ART } from '../../lib/time';
import { mailSettings } from '../mail/settings';
import { digestBeans } from './beans';

export default defineJobs((deps) => {
  const settings = mailSettings(deps.config);
  const log = deps.log.child({ component: 'DigestJob' });
  const enabled = settings.digest.jobsEnabled;
  const draft = async () => {
    try {
      await digestBeans(deps).service.createScheduledDraft();
    } catch (e) {
      log.warn(`Weekly digest draft could not be created: ${(e as Error).message}`);
    }
  };
  const createWeeklyDraft = async () => { await deps.jobLock.runExclusively('DIGEST_SCHEDULE', draft); };
  return {
    jobs: [
    {
      name: 'DigestJob#createWeeklyDraft', lock: 'DIGEST_SCHEDULE', enabled,
      schedule: { cron: '0 5 0 * * MON', zone: ART },
      run: draft,
    },
    {
      name: 'DigestJob#tick', lock: 'DIGEST_TICK', enabled,
      schedule: { fixedDelayMs: settings.digest.tickIntervalMs, initialDelayMs: 60_000 },
      run: async () => {
        await createWeeklyDraft();
        try {
          await digestBeans(deps).service.startDueAutoSends();
        } catch (e) {
          log.warn(`Digest auto-send check failed: ${(e as Error).message}`);
        }
        digestBeans(deps).kick();
      },
    },
    ],
    startup: [{
      name: 'DigestJob#onStartup', order: 10, enabled,
      run: async () => {
        await createWeeklyDraft();
        digestBeans(deps).kick();
      },
    }],
    shutdown: [
      { name: 'DigestSender#onShutdown', phase: 'closing', order: 10, run: () => digestBeans(deps).sender.onShutdown() },
      { name: 'DigestSender (task executor)', phase: 'executors', order: 10, run: () => digestBeans(deps).idle() },
    ],
  };
});
