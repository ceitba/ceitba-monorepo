// The PushTrigger publishing API news, proposals and corrections use, on top of the
// push feature's canonical one (src/features/push/service.ts: firePush =
// PushTriggerListener, FcmPushNotificationService / NoOp, push_log). Feature code
// collects triggers inside its transaction and calls `firePushes` AFTER the
// transaction committed (Java: @TransactionalEventListener AFTER_COMMIT + @Async):
// a rolled-back write sends nothing, the request never waits on FCM, failures are
// logged and never retried.

import type { Deps } from '../../deps';
import { firePush, pushForResource, pushIdle, pushToOrgFollowers, pushToUsers, type PushMessage } from '../push/service';

export type PushTrigger =
  | { kind: 'users'; userIds: string[]; message: PushMessage }
  | { kind: 'orgFollowers'; orgSlug: string; message: PushMessage };

/** PushMessage.forResource(title, body, type, id). */
export const forResource = pushForResource;

/** Resolves once every push fired so far was delivered and logged (tests). */
export function pendingPushes(): Promise<void> {
  return pushIdle();
}

/** Publish after commit: fire-and-forget, one delivery per trigger. */
export function firePushes(deps: Deps, triggers: readonly PushTrigger[]): void {
  for (const t of triggers) {
    firePush(deps, t.kind === 'users' ? pushToUsers(t.userIds, t.message) : pushToOrgFollowers(t.orgSlug, t.message));
  }
}
