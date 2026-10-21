// In-process port of MeProfileIT.savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently
// (apps/api/src/test/java/org/ceitba/api/web/user/MeProfileIT.java). Regression: a
// profile/preferences save used to UPDATE every column, so a file number / career
// another request committed between the read and the write was reset to the stale
// NULL. Like @DynamicUpdate, the services write only the changed columns
// (repo.updateUserColumns with the diff); this holds a transaction with a stale
// read while another connection commits, then writes the diff.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintJwt, seedCareer, seedUser } from '../../contract/support/identity';
import * as repo from '../../src/features/user/repo';
import { systemNowMicros, toPgTimestamp } from '../../src/lib/time';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

describe('MeProfileIT (concurrent writes)', () => {
  test('savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently', async () => {
    await t.sql`TRUNCATE public."user", public.careers CASCADE`;
    await seedCareer(t.sql, 'S', 'Informática');
    const id = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });

    await t.deps.db.transaction(async (tx) => {
      const managed = (await repo.findUser(tx, id))!;
      expect(managed.fileNumber).toBeNull();
      // Committed on another connection while this transaction holds the stale copy.
      const updated = await t.sql`UPDATE public."user" SET file_number = 61234, career_id = 'S' WHERE id = ${id}`;
      expect(updated.count).toBe(1);
      managed.theme = 'dark';
      await repo.updateUserColumns(tx, id, { theme: 'dark', updatedAt: toPgTimestamp(systemNowMicros()) });
    });

    const [after] = await t.sql`SELECT theme, file_number, career_id FROM public."user" WHERE id = ${id}`;
    expect(after).toEqual({ theme: 'dark', file_number: 61234, career_id: 'S' });
    const r = await t.request('GET', '/v1/me/profile', { headers: { Authorization: `Bearer ${await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' })}` } });
    expect(r.status).toBe(200);
    expect(r.json.careerId).toBe('S');
  });
});
