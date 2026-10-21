// The digest / mail / orgmail jobs: JobLock ids and schedules of
// scheduling/DigestJob, MailRetentionJob and OrgMailJob (see apps/api/docs/DEPLOY.md "Scheduled jobs").
import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config';
import { buildDeps } from '../../src/deps';
import { CONTRACT_ENV } from '../../contract/support/env';
import { silentLogger } from '../../src/infra/logger';
import digestJobs from '../../src/features/digest/jobs';
import mailJobs from '../../src/features/mail/jobs';
import orgJobs from '../../src/features/orgmail/jobs';
import { JOBS } from '../../src/jobs/joblock';
import { featureJobs } from '../../src/jobs/scheduler';

test('jobsUseTheJavaLockIdsAndSchedules', async () => {
  const config = await loadConfig({ ...CONTRACT_ENV, DIGEST_JOBS_ENABLED: 'true', ORG_MAIL_JOBS_ENABLED: 'true', DATABASE_URL: 'jdbc:postgresql://localhost:1/x' });
  const deps = await buildDeps(config, { log: silentLogger, push: null });
  try {
    const [d, m, o] = [await featureJobs(digestJobs, deps), await featureJobs(mailJobs, deps), await featureJobs(orgJobs, deps)];
    const all = [...d.jobs, ...m.jobs, ...o.jobs];
    // ApplicationReadyEvent listeners: DigestJob before OrgMailJob; ContextClosedEvent stop flags + executor drains.
    expect([...d.startup, ...o.startup].map((h) => [h.name, h.order, h.enabled])).toEqual([['DigestJob#onStartup', 10, true], ['OrgMailJob#onStartup', 40, true]]);
    expect([...d.shutdown, ...o.shutdown].map((h) => [h.name, h.phase])).toEqual([
      ['DigestSender#onShutdown', 'closing'], ['DigestSender (task executor)', 'executors'],
      ['OrgAnnouncementSender#onShutdown', 'closing'], ['OrgAnnouncementSender (task executor)', 'executors'],
    ]);
    const by = Object.fromEntries(all.map((j) => [j.name, j]));
    expect(by['DigestJob#createWeeklyDraft']).toMatchObject({ lock: 'DIGEST_SCHEDULE', enabled: true, schedule: { cron: '0 5 0 * * MON', zone: 'America/Argentina/Buenos_Aires' } });
    expect(by['DigestJob#tick']).toMatchObject({ lock: 'DIGEST_TICK', schedule: { fixedDelayMs: 300_000, initialDelayMs: 60_000 } });
    expect(by['MailRetentionJob#run']).toMatchObject({ lock: 'MAIL_RETENTION', schedule: { cron: '0 40 3 * * *', zone: 'America/Argentina/Buenos_Aires' } });
    expect(by['OrgMailJob#tick']!.lock).toBeUndefined();
    expect(by['OrgMailJob#tick']).toMatchObject({ schedule: { fixedDelayMs: 120_000, initialDelayMs: 60_000 } });
    expect(JOBS.DIGEST_SCHEDULE.id).toBe(6);
    expect(JOBS.DIGEST_TICK.id).toBe(7);
    expect(JOBS.MAIL_RETENTION.id).toBe(3);
  } finally {
    await deps.close();
  }
});
