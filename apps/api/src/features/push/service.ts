// service/push: PushNotificationService (FcmPushNotificationService /
// NoOpPushNotificationService), the PushTrigger events and PushTriggerListener.
//
// How other features send a push (the TS side of publishing a PushTrigger):
//
//   import { firePush, pushToUsers } from '../push/service';
//   const result = await withTx(deps.db, async (tx) => { ...; return x; });   // commit first
//   firePush(deps, pushToUsers([authorId], pushForResource('Tu propuesta fue aprobada', title, 'proposal', id)));
//
// Java delivers PushTrigger events AFTER the publishing transaction commits
// (fallbackExecution: right away when there is none), on a background thread,
// so fire it after `withTx` returns, never inside the transaction callback (a
// rollback must drop the push). `firePush` never throws and never blocks the
// request; `pushIdle()` lets tests wait for the background work (AsyncWork).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { MAX_TOKENS_PER_CALL, PushDeliveryError, type PushGateway, type PushOutcome } from '../../infra/push';
import type { Logger } from '../../infra/logger';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import { ID, TYPE, type PushMessage } from './logic/pushMessage';
import * as repo from './repo';

export { pushForResource, pushMessage, type PushMessage } from './logic/pushMessage';

/** PushResult(targeted, sent, pruned). */
export interface PushResult {
  readonly targeted: number;
  readonly sent: number;
  readonly pruned: number;
}
export const PUSH_RESULT_NONE: PushResult = Object.freeze({ targeted: 0, sent: 0, pruned: 0 });

/** The device-token queries the FCM sender needs (UserDeviceRepository). */
export interface PushDevices {
  findTokensByUserIds(userIds: string[]): Promise<string[]>;
  findTokensOfOrgFollowers(orgSlug: string): Promise<string[]>;
  findAllTokens(): Promise<string[]>;
  deleteByTokens(tokens: string[]): Promise<number>;
}

export function dbPushDevices(db: Db): PushDevices {
  return {
    findTokensByUserIds: (ids) => withTx(db, (tx) => repo.findTokensByUserIds(tx, ids), { readOnly: true }),
    findTokensOfOrgFollowers: (slug) => withTx(db, (tx) => repo.findTokensOfOrgFollowers(tx, slug), { readOnly: true }),
    findAllTokens: () => withTx(db, (tx) => repo.findAllTokens(tx), { readOnly: true }),
    deleteByTokens: (tokens) => withTx(db, (tx) => repo.deleteByTokens(tx, tokens)),
  };
}

export interface PushNotificationService {
  sendToUsers(userIds: Iterable<string>, message: PushMessage): Promise<PushResult>;
  /** Users following the organization (public.user_follows). */
  sendToOrgFollowers(orgSlug: string | null, message: PushMessage): Promise<PushResult>;
  /** Every registered device. */
  broadcast(message: PushMessage): Promise<PushResult>;
}

/**
 * FcmPushNotificationService: recipients -> tokens, batches of 500, dead-token
 * pruning. UNREGISTERED is always pruned; INVALID_ARGUMENT for EVERY token of a
 * multi-token batch means a malformed message (nothing pruned); a single-token
 * batch's INVALID_ARGUMENT is pruned. A failing batch is logged and skipped.
 */
export class FcmPushNotificationService implements PushNotificationService {
  constructor(private readonly gateway: PushGateway, private readonly devices: PushDevices, private readonly log: Logger) {}

  async sendToUsers(userIds: Iterable<string>, message: PushMessage): Promise<PushResult> {
    const ids = userIds == null ? [] : [...new Set(userIds)];
    if (ids.length === 0) return PUSH_RESULT_NONE;
    return this.deliver(await this.devices.findTokensByUserIds(ids), message);
  }

  async sendToOrgFollowers(orgSlug: string | null, message: PushMessage): Promise<PushResult> {
    if (orgSlug == null || orgSlug.trim() === '') return PUSH_RESULT_NONE;
    return this.deliver(await this.devices.findTokensOfOrgFollowers(orgSlug), message);
  }

  async broadcast(message: PushMessage): Promise<PushResult> {
    return this.deliver(await this.devices.findAllTokens(), message);
  }

  async deliver(tokenList: Iterable<string>, message: PushMessage): Promise<PushResult> {
    const tokens = [...new Set(tokenList)];
    if (tokens.length === 0) return PUSH_RESULT_NONE;
    let sent = 0;
    const dead: string[] = [];
    for (let from = 0; from < tokens.length; from += MAX_TOKENS_PER_CALL) {
      const batch = tokens.slice(from, Math.min(from + MAX_TOKENS_PER_CALL, tokens.length));
      let outcomes: PushOutcome[];
      try {
        outcomes = await this.gateway.send(batch, message);
      } catch (e) {
        if (!(e instanceof PushDeliveryError)) throw e;
        this.log.warn(`Push batch of ${batch.length} tokens failed: ${e.message}`);
        continue;
      }
      if (outcomes.length !== batch.length) {
        this.log.error(`Push gateway returned ${outcomes.length} outcomes for ${batch.length} tokens; not pruning`);
        sent += outcomes.filter((o) => o === 'SENT').length;
        continue;
      }
      if (batch.length > 1 && outcomes.every((o) => o === 'INVALID_ARGUMENT')) {
        this.log.error(`FCM rejected every token of a ${batch.length}-token batch with INVALID_ARGUMENT; assuming a malformed message (${JSON.stringify(message.data)}), not pruning`);
        continue;
      }
      batch.forEach((t, i) => {
        const o = outcomes[i];
        if (o === 'SENT') sent++;
        else if (o === 'UNREGISTERED' || o === 'INVALID_ARGUMENT') dead.push(t);
      });
    }
    let pruned = 0;
    if (dead.length > 0) {
      pruned = await this.devices.deleteByTokens(dead);
      this.log.info(`Pruned ${pruned} dead push tokens`);
    }
    this.log.debug(`Push '${message.title}': ${tokens.length} targeted, ${sent} sent, ${pruned} pruned`);
    return { targeted: tokens.length, sent, pruned };
  }
}

/** NoOpPushNotificationService: FCM not configured; pushes are dropped. */
export class NoOpPushNotificationService implements PushNotificationService {
  constructor(private readonly log?: Logger) {}
  async sendToUsers(userIds: Iterable<string>, message: PushMessage): Promise<PushResult> {
    this.log?.debug(`Push disabled; dropping message to ${[...userIds].length} users: ${message.title}`);
    return PUSH_RESULT_NONE;
  }
  async sendToOrgFollowers(orgSlug: string | null, message: PushMessage): Promise<PushResult> {
    this.log?.debug(`Push disabled; dropping message to followers of ${orgSlug}: ${message.title}`);
    return PUSH_RESULT_NONE;
  }
  async broadcast(message: PushMessage): Promise<PushResult> {
    this.log?.debug(`Push disabled; dropping broadcast: ${message.title}`);
    return PUSH_RESULT_NONE;
  }
}

/** config/PushConfig: the FCM service when a gateway exists, else NoOp. */
export function pushNotificationService(deps: Pick<Deps, 'push' | 'db' | 'log'>): PushNotificationService {
  const log = deps.log.child({ component: 'push' });
  return deps.push ? new FcmPushNotificationService(deps.push, dbPushDevices(deps.db), log) : new NoOpPushNotificationService(log);
}

// ------------------------------------------------------------ events

/** service/push/events: PushToUsers | PushToOrgFollowers | PushBroadcast. */
export type PushTrigger =
  | { readonly kind: 'PushToUsers'; readonly userIds: readonly string[]; readonly message: PushMessage }
  | { readonly kind: 'PushToOrgFollowers'; readonly orgSlug: string; readonly message: PushMessage }
  | { readonly kind: 'PushBroadcast'; readonly message: PushMessage };

export const pushToUsers = (userIds: Iterable<string>, message: PushMessage): PushTrigger =>
  ({ kind: 'PushToUsers', userIds: [...new Set(userIds)], message });
export const pushToOrgFollowers = (orgSlug: string, message: PushMessage): PushTrigger => {
  if (orgSlug == null) throw new TypeError('orgSlug');
  return { kind: 'PushToOrgFollowers', orgSlug, message };
};
export const pushBroadcast = (message: PushMessage): PushTrigger => ({ kind: 'PushBroadcast', message });

const inFlight = new Set<Promise<void>>();

/** Resolves once every push fired so far has been delivered and logged (AsyncWork.awaitIdle). */
export async function pushIdle(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/**
 * PushTriggerListener.on: deliver in the background, then record the reach in
 * push_log (even when push is disabled: the NoOp result is 0/0). Errors are
 * logged, never thrown. Call it after the publishing transaction committed.
 */
export function firePush(deps: Pick<Deps, 'push' | 'db' | 'log'>, trigger: PushTrigger, service: PushNotificationService = pushNotificationService(deps)): void {
  const log = deps.log.child({ component: 'PushTriggerListener' });
  const work = (async () => {
    await Promise.resolve();
    let result: PushResult;
    try {
      switch (trigger.kind) {
        case 'PushToUsers': result = await service.sendToUsers(trigger.userIds, trigger.message); break;
        case 'PushToOrgFollowers': result = await service.sendToOrgFollowers(trigger.orgSlug, trigger.message); break;
        case 'PushBroadcast': result = await service.broadcast(trigger.message); break;
      }
      log.debug(`${trigger.kind} delivered: ${JSON.stringify(result)}`);
    } catch (e) {
      log.error({ err: e }, `Push delivery failed for ${trigger.kind}`);
      return;
    }
    try {
      const data = trigger.message.data;
      const org = trigger.kind === 'PushToOrgFollowers' ? trigger.orgSlug : (data.org ?? null);
      await withTx(deps.db, (tx) => repo.insertPushLog(tx, {
        orgSlug: org, kind: data[TYPE] ?? null, refId: data[ID] ?? null,
        targeted: result.targeted, sent: result.sent, createdAt: toPgTimestamp(systemNowMicros()),
      }));
    } catch (e) {
      log.warn(`Push log write failed: ${(e as Error).message}`);
    }
  })();
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}
