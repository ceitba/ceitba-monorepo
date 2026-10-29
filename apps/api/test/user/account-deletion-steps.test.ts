// AccountDeletionService composes the correction and drive steps from those features'
// services itself: a deletion never depends on route registration. A deps without any
// route (a jobs-only process) deletes an account with Apuntes data and correction votes,
// running the real steps (before, an unregistered step made DELETE /v1/me answer 500).
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { buildDeps } from '../../src/deps';
import { accountDeletionSteps, AccountDeletionService } from '../../src/features/user/accountDeletion';
import { silentLogger } from '../../src/infra/logger';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

test('theDeletionStepsAreTheOwningFeaturesOwn', () => {
  expect(Object.keys(accountDeletionSteps()).sort()).toEqual(['drive.prepareAccountDeletion', 'scheduleCorrections.withdrawVotesOf']);
});

test('anAccountWithApuntesDataIsDeletedWithoutAnyRouteRegistered', async () => {
  // A second Deps on the same database, never passed to createApp.
  const deps = await buildDeps(t.deps.config, { log: silentLogger });
  try {
    const owner = crypto.randomUUID();
    await t.sql`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${owner}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    await t.sql`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
      VALUES (${crypto.randomUUID()}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    expect(await new AccountDeletionService(deps).deleteAccount(owner)).toBe('DELETED');
    expect((await t.sql`SELECT 1 FROM wiki.drive_source WHERE user_id = ${owner}`).length).toBe(0);
  } finally {
    await deps.close();
  }
});
