// scheduling/KbRelationJob + KbEmbeddingJob registration: JobLock ids, schedules,
// the enabled flag, and the ApplicationReadyEvent run holding readiness until done.
import { describe, expect, test } from 'bun:test';
import { Availability } from '../../src/deps';
import { JOBS } from '../../src/jobs/joblock';
import jobs from '../../src/features/kb-reader/jobs';
import { silentLogger } from '../../src/infra/logger';

function fakeDeps(enabled: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const locks: string[] = [];
  const deps = {
    config: { kb: { embeddings: { enabled, intervalMs: 300_000 } } },
    log: silentLogger,
    availability: new Availability(),
    jobLock: { runExclusively: async (job: string) => { locks.push(job); await gate; return false; } },
  };
  return { deps, locks, release };
}

describe('kb-reader jobs', () => {
  test('relationAndEmbeddingJobsWithTheirLocksAndSchedules', async () => {
    const { deps, locks, release } = fakeDeps(true);
    const defs = await jobs(deps as never);
    expect(defs.map((d) => [d.name, d.lock, d.schedule, d.enabled])).toEqual([
      ['KbRelationJob#run', 'KB_RELATIONS', { cron: '0 30 4 * * *' }, true],
      ['KbEmbeddingJob#run', 'KB_EMBEDDINGS', { fixedDelayMs: 300_000, initialDelayMs: 60_000 }, true],
    ]);
    expect(JOBS.KB_RELATIONS.id).toBe(4);
    expect(JOBS.KB_EMBEDDINGS.id).toBe(5);

    // The startup run (ApplicationReadyEvent) holds readiness until it returns.
    expect(locks).toEqual(['KB_RELATIONS']);
    expect(deps.availability.acceptingTraffic).toBe(false);
    release();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(deps.availability.acceptingTraffic).toBe(true);

    // Discovered again for the same deps: no second startup run.
    await jobs(deps as never);
    expect(locks).toEqual(['KB_RELATIONS']);
  });

  test('embeddingJobFollowsKbEmbeddingsEnabled', async () => {
    const { deps, release } = fakeDeps(false);
    const defs = await jobs(deps as never);
    release();
    expect(defs.find((d) => d.lock === 'KB_EMBEDDINGS')!.enabled).toBe(false);
  });
});
