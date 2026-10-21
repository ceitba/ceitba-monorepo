// Port of apps/api/src/test/java/org/ceitba/api/service/staff/ModeratorServiceTest.java:
// listActive loads the users in one batch and keeps grant order, with a grant
// whose user row is gone (Mockito -> real rows; the orphan grant is inserted with
// FK triggers off, as the IT's "user row deleted meanwhile").
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { seedUser } from '../../contract/support/identity';
import { ModeratorService } from '../../src/features/staff/service';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

describe('ModeratorServiceTest', () => {
  test('listActiveLoadsUsersInOneBatchAndKeepsGrantOrder', async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    const alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    const gone = crypto.randomUUID();
    await t.sql`INSERT INTO public.ceitba_moderators (user_id, granted_at) VALUES (${bob}, now() - interval '2 days'), (${alice}, now())`;
    await t.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`INSERT INTO public.ceitba_moderators (user_id, granted_at) VALUES (${gone}, now() - interval '1 day')`;
    });

    const result = await new ModeratorService(t.deps).listActive();
    expect(result.map((m) => m.userId)).toEqual([bob, gone, alice]);
    expect(result.map((m) => m.email)).toEqual(['bob@itba.edu.ar', null, 'alice@itba.edu.ar']);
    await t.sql`TRUNCATE public."user", public.ceitba_moderators CASCADE`;
  });
});
