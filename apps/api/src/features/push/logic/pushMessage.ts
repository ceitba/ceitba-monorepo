// Port of apps/api/src/main/java/org/ceitba/api/service/push/PushMessage.java.
// One notification as shown on the device, plus the data payload the app uses
// to deep-link ("type" + "id"). FCM data values must be strings.

import { javaIsBlank } from '../../../lib/javaCompat';

export const TYPE = 'type';
export const ID = 'id';

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Immutable copy without null values. */
  readonly data: Readonly<Record<string, string>>;
}

/** IllegalArgumentException of the record's compact constructor. */
export class PushMessageError extends Error {}

export function pushMessage(title: string | null | undefined, body: string | null | undefined,
                            data?: Record<string, string | null | undefined> | Map<string, string | null | undefined> | null): PushMessage {
  if (title == null || javaIsBlank(title)) throw new PushMessageError('title is required');
  if (body == null || javaIsBlank(body)) throw new PushMessageError('body is required');
  const copy: Record<string, string> = {};
  if (data != null) {
    const entries = data instanceof Map ? [...data.entries()] : Object.entries(data);
    for (const [k, v] of entries) if (v != null) copy[k] = v;
  }
  return Object.freeze({ title, body, data: Object.freeze(copy) });
}

export function pushForResource(title: string, body: string, type: string, id: string): PushMessage {
  // Map.of(TYPE, type, ID, id) throws on null values.
  if (type == null || id == null) throw new TypeError('type and id are required');
  return pushMessage(title, body, { [TYPE]: type, [ID]: id });
}
