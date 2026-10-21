// AccountDeletionService calls into the correction and drive features through
// registered steps; a missing registration makes DELETE /v1/me answer 500 for
// users with that data. Building the app's routes must register both.
import { expect, test } from 'bun:test';
import { tsRoutes } from '../../contract/support/routes';
import { registeredAccountDeletionSteps } from '../../src/features/user/accountDeletion';

test('theAppRegistersEveryAccountDeletionStep', async () => {
  await tsRoutes();
  expect(registeredAccountDeletionSteps()).toEqual(['drive.prepareAccountDeletion', 'scheduleCorrections.withdrawVotesOf']);
});
