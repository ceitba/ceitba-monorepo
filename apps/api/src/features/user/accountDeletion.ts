// service/user/AccountDeletionService (DELETE /v1/me; App Store rule 5.1.1(v)).
// One transaction; the per-table policy is AccountDeletionService.java's:
// personal rows deleted, shared content detached, wiki contributions with a
// NOT NULL author kept (the user row is then anonymized instead of deleted),
// the legacy Firebase uid remembered hashed. The only active staff member
// cannot delete their account (409 LastActiveStaff; the check locks the active
// staff rows), nor the only admin of an organization (409 LastOrgAdmin).
//
// Two steps belong to other features and are plugged in by them:
//   'scheduleCorrections.withdrawVotesOf'  ScheduleCorrectionService.withdrawVotesOf
//       (recount + re-evaluate the corrections the user voted on, under the commission lock)
//   'drive.prepareAccountDeletion'         DriveModerationService.prepareAccountDeletion
//       (withdraw the user's reports and recompute, kb.forgetFiles, stored copies deleted after commit)
// The owning feature registers its implementation from its routes.ts:
//   registerAccountDeletionStep('drive.prepareAccountDeletion', async (tx, userId, deps) => { ...; return afterCommit; });
// A step may return a function run after the deletion commits (best effort).
// While a step is not registered, a deletion that would need it (the user has
// correction votes / Apuntes data) fails with 500 and logs which step is
// missing instead of silently skipping it; accounts without such data are
// deleted normally.

import type { Deps } from '../../deps';
import { withTx, type Db, type Tx } from '../../db/client';
import { LastActiveStaffError, LastOrgAdminError } from '../../http/errors';
import { toPgTimestamp } from '../../lib/time';
import * as del from './deletionRepo';
import { lockActiveStaffIds, lockOrgAdmins, isActiveStaffAt } from './repo';

export type AccountDeletionStepName = 'scheduleCorrections.withdrawVotesOf' | 'drive.prepareAccountDeletion';
export type AccountDeletionStep = (tx: Tx, userId: string, deps: Deps) => Promise<void | (() => Promise<void>)>;

const steps = new Map<AccountDeletionStepName, AccountDeletionStep>();

/**
 * Registers (replaces) the implementation of a step; returns a function that undoes it, restoring
 * the implementation it replaced (a test stub must not leave the real step unregistered).
 */
export function registerAccountDeletionStep(name: AccountDeletionStepName, step: AccountDeletionStep): () => void {
  const previous = steps.get(name);
  steps.set(name, step);
  return () => {
    if (steps.get(name) !== step) return;
    if (previous) steps.set(name, previous);
    else steps.delete(name);
  };
}

/** The steps registered so far (the app registers them while collecting the routes). */
export function registeredAccountDeletionSteps(): AccountDeletionStepName[] {
  return [...steps.keys()].sort();
}

export type DeletionOutcome = 'DELETED' | 'ANONYMIZED';

export class AccountDeletionService {
  constructor(private readonly deps: Deps) {}

  /** `db`: the pool (own transaction) or a caller's transaction (joins it, like @Transactional REQUIRED). */
  async deleteAccount(userId: string, db: Db = this.deps.db): Promise<DeletionOutcome> {
    const log = this.deps.log.child({ component: 'AccountDeletionService' });
    const afterCommit: (() => Promise<void>)[] = [];
    const outcome = await withTx(db, async (tx) => {
      const nowPg = toPgTimestamp(this.deps.clock.now());
      if (await isActiveStaffAt(tx, userId, nowPg)) {
        // Locks every active staff row before looking: concurrent deletions of the last two serialize.
        const others = (await lockActiveStaffIds(tx, nowPg)).some((id) => id !== userId);
        if (!others) throw new LastActiveStaffError('You are the only active staff member. Grant the STAFF role to someone else before deleting your account.');
      }
      for (const org of await del.adminOrgsOf(tx, userId)) {
        if (!(await lockOrgAdmins(tx, org)).some((id) => id !== userId)) {
          throw new LastOrgAdminError(`You are the only admin of '${org}'. Make another member admin first.`);
        }
      }
      await del.recordDeletedFirebaseAccount(tx, userId);
      await del.deleteSessionsAndCredentials(tx, userId);
      await del.deleteStaffMembership(tx, userId);
      await del.deleteSocialData(tx, userId);
      await del.deleteSchedulesAndShares(tx, userId);
      await del.deleteStudyGroups(tx, userId);
      await del.deleteWikiPersonalData(tx, userId);
      await del.detachNewsletterAuthorship(tx, userId);
      await del.deleteProposalData(tx, userId);
      await this.step('scheduleCorrections.withdrawVotesOf', tx, userId, () => del.hasScheduleCorrectionVotes(tx, userId), afterCommit);
      await del.detachScheduleCorrections(tx, userId);
      await this.step('drive.prepareAccountDeletion', tx, userId, () => del.hasDriveData(tx, userId), afterCommit);
      await del.deleteDriveSources(tx, userId);
      await del.deleteKbReports(tx, userId);
      await del.deleteCapabilityGrants(tx, userId);
      await del.deleteOrgInvites(tx, userId);

      if ((await del.countRetainedContributions(tx, userId)) > 0) {
        await del.anonymizeUser(tx, userId);
        log.info(`Account ${userId} anonymized (shared wiki contributions retained)`);
        return 'ANONYMIZED' as const;
      }
      await del.deleteUser(tx, userId);
      log.info(`Account ${userId} deleted`);
      return 'DELETED' as const;
    });
    for (const fn of afterCommit) {
      try {
        await fn();
      } catch (e) {
        log.warn(`Account deletion clean-up failed: ${(e as Error).message}`);
      }
    }
    return outcome;
  }

  private async step(name: AccountDeletionStepName, tx: Tx, userId: string, needed: () => Promise<boolean>, afterCommit: (() => Promise<void>)[]) {
    const s = steps.get(name);
    if (s) {
      const after = await s(tx, userId, this.deps);
      if (typeof after === 'function') afterCommit.push(after);
      return;
    }
    if (await needed()) {
      this.deps.log.error(`Account deletion of ${userId} needs the '${name}' step, which no feature registered (registerAccountDeletionStep)`);
      throw new Error(`Account deletion step '${name}' is not registered`);
    }
  }
}
