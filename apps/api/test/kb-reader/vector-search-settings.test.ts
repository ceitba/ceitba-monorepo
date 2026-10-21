// The semantic search transaction sets hnsw.iterative_scan and plan_cache_mode = force_custom_plan
// (a cached generic plan skips the HNSW index for a bound query vector), both transaction-local.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTx } from '../../src/db/client';
import { enableIterativeScan } from '../../src/features/kb-reader/repo';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

const settings = async (db: Parameters<typeof enableIterativeScan>[0]) =>
  [...await db.execute<{ scan: string; mode: string }>(sql`SELECT current_setting('hnsw.iterative_scan') AS scan, current_setting('plan_cache_mode') AS mode`)][0]!;

test('theSearchTransactionForcesCustomPlansAndIterativeScans', async () => {
  const inside = await withTx(t.deps.db, async (tx) => {
    await enableIterativeScan(tx);
    return settings(tx);
  }, { readOnly: true });
  expect(inside).toEqual({ scan: 'strict_order', mode: 'force_custom_plan' });
  // Transaction-local: the pool's next transaction is back to the defaults.
  expect((await withTx(t.deps.db, (tx) => settings(tx), { readOnly: true })).mode).toBe('auto');
});
