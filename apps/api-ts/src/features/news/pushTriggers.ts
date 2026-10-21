// service/push/events/PushTrigger + PushTriggerListener + FcmPushNotificationService
// (the parts news and proposals need), until the push feature exposes a shared
// publish API. Feature code collects triggers inside its transaction and calls
// `firePushes` AFTER the transaction committed (Java: @TransactionalEventListener
// AFTER_COMMIT + @Async): a rolled-back write sends nothing, the request never
// waits on FCM, failures are logged and never retried.
//
// With no gateway (FCM not configured) Java runs NoOpPushNotificationService,
// which returns PushResult.NONE (0 targeted, 0 sent) and the listener still
// writes the push_log row.

import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { MAX_TOKENS_PER_CALL, PushDeliveryError, pushMessage, type PushMessage } from '../../infra/push';

export type PushTrigger =
  | { kind: 'users'; userIds: string[]; message: PushMessage }
  | { kind: 'orgFollowers'; orgSlug: string; message: PushMessage };

export interface PushResult {
  targeted: number;
  sent: number;
  pruned: number;
}

const NONE: PushResult = { targeted: 0, sent: 0, pruned: 0 };

/** PushMessage.forResource(title, body, type, id). */
export function forResource(title: string, body: string, type: string, id: string): PushMessage {
  return pushMessage(title, body, { type, id });
}

/** Deliveries still running (tests may await them). */
const inFlight = new Set<Promise<void>>();

export function pendingPushes(): Promise<void> {
  return Promise.all([...inFlight]).then(() => undefined);
}

/** Publish after commit: fire-and-forget, one delivery per trigger. */
export function firePushes(deps: Deps, triggers: readonly PushTrigger[]): void {
  for (const t of triggers) {
    const p = deliverTrigger(deps, t).catch((e) => deps.log.error({ err: e }, 'Push delivery failed'));
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  }
}

async function deliverTrigger(deps: Deps, t: PushTrigger): Promise<void> {
  let result: PushResult;
  try {
    result = await send(deps, t);
  } catch (e) {
    deps.log.error({ err: e }, `Push delivery failed for ${t.kind === 'users' ? 'PushToUsers' : 'PushToOrgFollowers'}`);
    return;
  }
  // PushTriggerListener.record: never fails the delivery.
  try {
    const data = t.message.data;
    const org = t.kind === 'orgFollowers' ? t.orgSlug : (data.org ?? null);
    await deps.db.execute(sql`INSERT INTO public.push_log (org_slug, kind, ref_id, targeted, sent, created_at)
      VALUES (${org}, ${data.type ?? null}, ${data.id ?? null}, ${result.targeted}, ${result.sent}, now())`);
  } catch (e) {
    deps.log.warn(`Push log write failed: ${(e as Error).message}`);
  }
}

async function send(deps: Deps, t: PushTrigger): Promise<PushResult> {
  if (!deps.push) return NONE; // NoOpPushNotificationService
  let tokens: string[];
  if (t.kind === 'users') {
    if (t.userIds.length === 0) return NONE;
    const ids = sql.join(t.userIds.map((id) => sql`${id}::uuid`), sql`, `);
    tokens = (await deps.db.execute<{ token: string }>(sql`SELECT d.token FROM public.user_devices d WHERE d.user_id IN (${ids})`)).map((r) => r.token);
  } else {
    if (t.orgSlug.trim() === '') return NONE;
    tokens = (await deps.db.execute<{ token: string }>(sql`SELECT d.token FROM public.user_devices d
      JOIN public.user_follows f ON f.user_id = d.user_id WHERE f.org_slug = ${t.orgSlug}`)).map((r) => r.token);
  }
  return deliver(deps, tokens, t.message);
}

/** FcmPushNotificationService.deliver. */
async function deliver(deps: Deps, tokenList: string[], message: PushMessage): Promise<PushResult> {
  const tokens = [...new Set(tokenList)];
  if (tokens.length === 0) return NONE;
  let sent = 0;
  const dead: string[] = [];
  for (let from = 0; from < tokens.length; from += MAX_TOKENS_PER_CALL) {
    const batch = tokens.slice(from, from + MAX_TOKENS_PER_CALL);
    let outcomes;
    try {
      outcomes = await deps.push!.send(batch, message);
    } catch (e) {
      if (e instanceof PushDeliveryError) {
        deps.log.warn(`Push batch of ${batch.length} tokens failed: ${e.message}`);
        continue;
      }
      throw e;
    }
    if (outcomes.length !== batch.length) {
      deps.log.error(`Push gateway returned ${outcomes.length} outcomes for ${batch.length} tokens; not pruning`);
      sent += outcomes.filter((o) => o === 'SENT').length;
      continue;
    }
    if (batch.length > 1 && outcomes.every((o) => o === 'INVALID_ARGUMENT')) {
      deps.log.error(`FCM rejected every token of a ${batch.length}-token batch with INVALID_ARGUMENT; assuming a malformed message, not pruning`);
      continue;
    }
    outcomes.forEach((o, i) => {
      if (o === 'SENT') sent++;
      else if (o === 'UNREGISTERED' || o === 'INVALID_ARGUMENT') dead.push(batch[i]!);
    });
  }
  let pruned = 0;
  if (dead.length > 0) {
    const list = sql.join(dead.map((d) => sql`${d}`), sql`, `);
    const rows = await deps.db.execute(sql`DELETE FROM public.user_devices WHERE token IN (${list}) RETURNING token`);
    pruned = rows.length;
  }
  return { targeted: tokens.length, sent, pruned };
}
