// withSavepoint: a failed savepoint rolls back only its own writes and leaves the
// outer transaction usable (DigestService.createDraft and DataSync rely on it).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { isUniqueViolation, withSavepoint, withTx } from '../../src/db/client';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

test('aFailedSavepointRollsBackOnlyItsWritesAndTheTransactionCommits', async () => {
  await t.sql`DELETE FROM public.careers WHERE id IN ('SP1', 'SP2', 'SP3')`;
  const insert = (db: Parameters<typeof withSavepoint>[0], id: string) =>
    db.execute(sql`INSERT INTO public.careers (id, name, updated_at) VALUES (${id}, ${id}, now())`);
  await withTx(t.deps.db, async (tx) => {
    await insert(tx, 'SP1');
    const err = await withSavepoint(tx, async (sp) => {
      await insert(sp, 'SP2');
      await insert(sp, 'SP1');                       // unique violation: the savepoint (and SP2) roll back
    }).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    await insert(tx, 'SP3');                         // the outer transaction is still usable
  });
  const ids = (await t.sql<{ id: string }[]>`SELECT id FROM public.careers WHERE id LIKE 'SP%' ORDER BY id`).map((r) => r.id);
  expect(ids).toEqual(['SP1', 'SP3']);
});
