// service/push/PushBroadcastService: STAFF broadcast to every registered device
// (POST /v1/staff/push/broadcast). Only queues the push; delivery is async.

import type { Deps } from '../../deps';
import { ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { pushMessage } from './logic/pushMessage';
import { firePush, pushBroadcast } from './service';

export const MAX_KEY_LENGTH = 64;
export const MAX_VALUE_LENGTH = 200;
// FCM rejects these data keys (INVALID_ARGUMENT for every token).
const RESERVED_KEYS = new Set(['from', 'notification', 'message_type', 'collapse_key']);

export class PushBroadcastService {
  constructor(private readonly deps: Deps) {}

  broadcast(title: string, body: string, data: Record<string, string | null> | null, requestedBy: string | null): void {
    if (data != null) for (const [k, v] of Object.entries(data)) validateEntry(k, v);
    const message = pushMessage(javaTrim(title), javaTrim(body), data);
    this.deps.log.child({ component: 'PushBroadcastService' }).info(`Push broadcast queued by ${requestedBy}: '${message.title}'`);
    firePush(this.deps, pushBroadcast(message));
  }
}

function validateEntry(key: string, value: string | null) {
  if (javaIsBlank(key) || key.length > MAX_KEY_LENGTH) {
    throw new ValidationError('data', key, `keys must be 1-${MAX_KEY_LENGTH} characters`);
  }
  const lower = key.toLowerCase();
  if (RESERVED_KEYS.has(lower) || lower.startsWith('google.') || lower.startsWith('gcm.')) {
    throw new ValidationError('data', key, 'reserved by FCM');
  }
  if (value != null && value.length > MAX_VALUE_LENGTH) {
    throw new ValidationError(`data.${key}`, `${value.length} characters`, `values must be at most ${MAX_VALUE_LENGTH} characters`);
  }
}
