// scheduling/DigestJob (off with DIGEST_JOBS_ENABLED=false):
//   - Monday 00:05 ART: the draft for the week that just ended (JobLock 6, DIGEST_SCHEDULE)
//   - every DIGEST_TICK_INTERVAL (initial 1 min): the same draft as a catch-up (nested
//     DIGEST_SCHEDULE lock), start due auto-sends, kick the worker (JobLock 7, DIGEST_TICK)
//   - ApplicationReadyEvent: the draft + the worker. There is no startup hook in
//     src/jobs, so it is a fixed-delay job that only acts on its first run.
// The worker (DigestSender) runs detached from the tick ("task executor").
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
  let started = false;
  return [
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
    {
      name: 'DigestJob#onStartup', enabled,
      schedule: { fixedDelayMs: 24 * 3_600_000, initialDelayMs: 0 },
      run: async () => {
        if (started) return;
        started = true;
        await createWeeklyDraft();
        digestBeans(deps).kick();
      },
    },
  ];
});
