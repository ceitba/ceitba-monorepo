// In-process port of AccountDeletionIT.concurrentDeletionsCannotRemoveTheLastStaffMember
// (apps/api/src/test/java/org/ceitba/api/web/user/AccountDeletionIT.java): the last two
// staff members delete their accounts at the same time. The guard locks the
// active staff rows, so Bob's call waits for Alice's uncommitted deletion and then
// sees he is the only one left. Plus how a cross-feature step runs.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { seedUser } from '../../contract/support/identity';
import { LastActiveStaffError } from '../../src/http/errors';
import { AccountDeletionService } from '../../src/features/user/accountDeletion';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let svc: AccountDeletionService;
beforeAll(async () => {
  t = await testApp();
  svc = new AccountDeletionService(t.deps);
}, 60_000);
afterAll(() => t?.close());

let alice: string;
let bob: string;
const staffRow = (u: string) => t.sql`INSERT INTO public.ceitba_staff (user_id, branch, start, "end") VALUES (${u}, 'IT', now() - interval '1 day', now() + interval '1 day')`;
const exists = async (u: string) => (await t.sql`SELECT 1 FROM public."user" WHERE id = ${u}`).length > 0;

describe('AccountDeletionIT (concurrency)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    await staffRow(alice);
    await staffRow(bob);
  });

  test('concurrentDeletionsCannotRemoveTheLastStaffMember', async () => {
    let deleted!: () => void;
    const aliceDeleted = new Promise<void>((r) => { deleted = r; });
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    const aliceCall = t.deps.db.transaction(async (tx) => {
      await svc.deleteAccount(alice, tx);
      deleted();
      await Promise.race([released, Bun.sleep(10_000)]);
    });
    await aliceDeleted;

    let bobSettled = false;
    const bobCall = svc.deleteAccount(bob).finally(() => { bobSettled = true; });
    bobCall.catch(() => {});
    await Bun.sleep(500);
    // Bob's guard must wait for Alice's uncommitted deletion.
    expect(bobSettled).toBe(false);

    release();
    await aliceCall;
    await expect(bobCall).rejects.toBeInstanceOf(LastActiveStaffError);

    expect(await exists(alice)).toBe(false);
    expect(await exists(bob)).toBe(true);
    expect((await t.sql`SELECT 1 FROM public.ceitba_staff WHERE user_id = ${bob}`).length).toBe(1);
  }, 30_000);

  test('aStepRunsInTheTransactionAndItsAfterCommitAfterwards', async () => {
    await t.sql`DELETE FROM public.ceitba_staff WHERE user_id = ${alice}`;
    const seen: string[] = [];
    const stubbed = new AccountDeletionService(t.deps, {
      'drive.prepareAccountDeletion': async (tx, userId) => {
        const [r] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public."user" WHERE id = ${userId}`);
        seen.push(`in-tx:${Number(r?.n)}`);
        return async () => { seen.push(`after:${(await exists(userId)) ? 'present' : 'gone'}`); };
      },
    });
    expect(await stubbed.deleteAccount(alice)).toBe('DELETED');
    expect(seen).toEqual(['in-tx:1', 'after:gone']);
  });
});
