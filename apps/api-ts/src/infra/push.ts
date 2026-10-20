// Push transport (service/push/PushGateway + FirebasePushGateway, config/PushConfig).
// A gateway exists only when FIREBASE_SERVICE_ACCOUNT_JSON (raw or base64) or
// _PATH is set; otherwise `createPushGateway` returns null and the push feature
// uses its NoOp service (FCM push disabled). Tests inject FakePushGateway.

import { readFileSync } from 'node:fs';
import type { Config } from '../config';

export const MAX_TOKENS_PER_CALL = 500;
export type PushOutcome = 'SENT' | 'UNREGISTERED' | 'INVALID_ARGUMENT' | 'FAILED';

export interface PushMessage {
  title: string;
  body: string;
  /** By convention "type" and "id" (deep link). FCM data values are strings. */
  data: Record<string, string>;
}

export function pushMessage(title: string, body: string, data: Record<string, string | null | undefined> = {}): PushMessage {
  if (!title?.trim()) throw new Error('title is required');
  if (!body?.trim()) throw new Error('body is required');
  const d: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (v != null) d[k] = v;
  return { title, body, data: d };
}

/** PushDeliveryException: the multicast call as a whole failed. */
export class PushDeliveryError extends Error {}

export interface PushGateway {
  /** One outcome per token, in order. Throws PushDeliveryError when the call fails. */
  send(tokens: string[], message: PushMessage): Promise<PushOutcome[]>;
  close?(): Promise<void>;
}

/** FakePushGateway (src/test/java): records sends; outcomes scripted per token. */
export class FakePushGateway implements PushGateway {
  readonly calls: { tokens: string[]; message: PushMessage }[] = [];
  outcomes = new Map<string, PushOutcome>();
  failNext: Error | null = null;
  async send(tokens: string[], message: PushMessage) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.calls.push({ tokens: [...tokens], message });
    return tokens.map((t) => this.outcomes.get(t) ?? 'SENT');
  }
}

export class FirebasePushGateway implements PushGateway {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(private readonly app: any, private readonly messaging: any) {}

  static async fromServiceAccount(json: string): Promise<FirebasePushGateway> {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = initializeApp({ credential: cert(JSON.parse(json)) }, 'ceitba-push');
    return new FirebasePushGateway(app, getMessaging(app));
  }

  async send(tokens: string[], message: PushMessage): Promise<PushOutcome[]> {
    if (tokens.length === 0) return [];
    if (tokens.length > MAX_TOKENS_PER_CALL) throw new Error(`At most ${MAX_TOKENS_PER_CALL} tokens per call`);
    let response;
    try {
      response = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default', contentAvailable: true } } },
      });
    } catch (e) {
      throw new PushDeliveryError(`FCM multicast failed: ${(e as { code?: string }).code ?? (e as Error).message}`);
    }
    return response.responses.map((r: { success: boolean; error?: { code?: string } }) => {
      if (r.success) return 'SENT';
      const code = r.error?.code ?? '';
      if (code === 'messaging/registration-token-not-registered') return 'UNREGISTERED';
      if (code === 'messaging/invalid-argument' || code === 'messaging/invalid-registration-token') return 'INVALID_ARGUMENT';
      return 'FAILED';
    });
  }

  async close() {
    await this.app.delete();
  }
}

/** PushConfig.open: raw JSON (starts with `{`), base64 (MIME decoder), or a file path. */
export function readServiceAccount(cfg: Config['integrations']['push']): string | null {
  const raw = cfg.serviceAccountJson.trim();
  if (raw) return raw.startsWith('{') ? raw : Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (cfg.serviceAccountPath.trim()) return readFileSync(cfg.serviceAccountPath.trim(), 'utf8');
  return null;
}

export async function createPushGateway(config: Config): Promise<PushGateway | null> {
  const json = readServiceAccount(config.integrations.push);
  return json ? FirebasePushGateway.fromServiceAccount(json) : null;
}
