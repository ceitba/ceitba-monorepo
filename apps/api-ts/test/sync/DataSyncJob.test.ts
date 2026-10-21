// scheduling/DataSyncJob: registered as 'DataSyncJob#run' under JobLock DATA_SYNC
// (JobLockCoverageTest's rule), cron "0 0 0,12 * * *" in the server zone,
// enabled only by SYNC_ENABLED (@ConditionalOnProperty sync.enabled), and a
// failing sync is logged, not thrown.
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import type { Deps } from '../../src/deps';
import type { ItbaApiClient } from '../../src/external/itba';
import jobs from '../../src/features/sync/jobs';
import { MutableClock } from '../../src/infra/clock';
import { silentLogger } from '../../src/infra/logger';

async function deps(env: Record<string, string>, itba: ItbaApiClient): Promise<Deps> {
  const config = await loadConfig({ ...CONTRACT_ENV, ...env });
  const failingDb = { execute: async () => { throw new Error('db down'); } };
  return { config, log: silentLogger, clock: new MutableClock(), itba, db: failingDb } as unknown as Deps;
}
const noItba: ItbaApiClient = {
  getSubjectsByPlan: async () => [], getCommissions: async () => [], getCommissionsBySubject: async () => [],
};

describe('DataSyncJob', () => {
  test('registeredWithItsLockAndCron', async () => {
    const [job, ...rest] = await jobs(await deps({}, noItba));
    expect(rest).toEqual([]);
    expect(job!.name).toBe('DataSyncJob#run');
    expect(job!.lock).toBe('DATA_SYNC');
    expect(job!.schedule).toEqual({ cron: '0 0 0,12 * * *' });
    expect(job!.enabled).toBe(false);
    expect((await jobs(await deps({ SYNC_ENABLED: 'true' }, noItba)))[0]!.enabled).toBe(true);
  });

  test('aFailingSyncIsLoggedNotThrown', async () => {
    const [job] = await jobs(await deps({ SYNC_ENABLED: 'true' }, noItba));
    await expect(job!.run()).resolves.toBeUndefined();
  });
});
