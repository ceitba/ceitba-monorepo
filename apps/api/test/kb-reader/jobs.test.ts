// scheduling/KbRelationJob + KbEmbeddingJob registration: JobLock ids, schedules,
// the enabled flag, and the ApplicationReadyEvent run as a startup hook (main.ts
// keeps readiness down until the startup hooks return: test/jobs/lifecycle.test.ts).
import { describe, expect, test } from 'bun:test';
import { Availability } from '../../src/deps';
import { JOBS } from '../../src/jobs/joblock';
import { featureJobs } from '../../src/jobs/scheduler';
import jobs from '../../src/features/kb-reader/jobs';
import { silentLogger } from '../../src/infra/logger';

function fakeDeps(enabled: boolean) {
  const locks: string[] = [];
  const deps = {
    config: { kb: { embeddings: { enabled, intervalMs: 300_000 } } },
    log: silentLogger,
    availability: new Availability(),
    jobLock: { runExclusively: async (job: string) => { locks.push(job); return false; } },
  };
  return { deps, locks };
}

describe('kb-reader jobs', () => {
  test('relationAndEmbeddingJobsWithTheirLocksAndSchedules', async () => {
    const { deps, locks } = fakeDeps(true);
    const defs = await featureJobs(jobs, deps as never);
    expect(defs.jobs.map((d) => [d.name, d.lock, d.schedule, d.enabled])).toEqual([
      ['KbRelationJob#run', 'KB_RELATIONS', { cron: '0 30 4 * * *' }, true],
      ['KbEmbeddingJob#run', 'KB_EMBEDDINGS', { fixedDelayMs: 300_000, initialDelayMs: 60_000 }, true],
    ]);
    expect(JOBS.KB_RELATIONS.id).toBe(4);
    expect(JOBS.KB_EMBEDDINGS.id).toBe(5);

    // Discovery does no work; the startup run (ApplicationReadyEvent) is a hook, under the same lock.
    expect(locks).toEqual([]);
    expect(defs.startup.map((h) => [h.name, h.order, h.enabled])).toEqual([['KbRelationJob#run', 30, true]]);
    await defs.startup[0]!.run();
    expect(locks).toEqual(['KB_RELATIONS']);
  });

  test('embeddingJobFollowsKbEmbeddingsEnabled', async () => {
    const { deps } = fakeDeps(false);
    const defs = await featureJobs(jobs, deps as never);
    expect(defs.jobs.find((d) => d.lock === 'KB_EMBEDDINGS')!.enabled).toBe(false);
  });
});
