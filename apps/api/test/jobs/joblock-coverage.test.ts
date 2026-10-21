// Port of JobLockCoverageTest: every scheduled job (every src/features/*/jobs.ts,
// whatever its enabled flag) runs under JobLock with its Java id, except the
// ones exempt for a stated reason; ids are unique and 8 (retired ORG_MAIL) is
// never reused. Also checks the job names match Java's @Scheduled methods.
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { buildDeps } from '../../src/deps';
import { silentLogger } from '../../src/infra/logger';
import { JOBS } from '../../src/jobs/joblock';
import { discoverJobs } from '../../src/jobs/scheduler';

// Jobs whose cross-process safety comes from elsewhere.
const EXEMPT = new Set([
  'OrgMailJob#tick', // hands off to the sender; its delivery claims (SKIP LOCKED) prevent double sends
]);

describe('JobLockCoverageTest', () => {
  test('everyScheduledMethodHasAJobLock', async () => {
    // Every flag on, so every job is discovered as it would be in production.
    const config = await loadConfig({
      ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x', SYNC_ENABLED: 'true', DIGEST_JOBS_ENABLED: 'true',
      ORG_MAIL_JOBS_ENABLED: 'true', EVENT_REMINDERS_ENABLED: 'true', KB_PIPELINE_BACKGROUND: 'true', KB_EMBEDDINGS_ENABLED: 'true',
      DRIVE_SYNC_ENABLED: 'true',
    });
    const deps = await buildDeps(config, { log: silentLogger, push: null });
    try {
      const jobs = await discoverJobs(deps);
      const scheduled = [...new Set(jobs.map((j) => j.name))].sort();
      const covered = [...new Set([...Object.values(JOBS).map((j) => j.method), ...EXEMPT])].sort();
      expect(scheduled.length).toBeGreaterThan(0);
      expect(scheduled).toEqual(covered);
      for (const j of jobs) {
        if (EXEMPT.has(j.name)) expect(j.lock).toBeUndefined();
        else expect(j.lock ? (JOBS[j.lock].method as string) : null).toBe(j.name);
      }
    } finally {
      await deps.close();
    }
  });

  test('jobIdsAreUnique', () => {
    const ids = Object.values(JOBS).map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(8); // 8: retired ORG_MAIL
  });
});
