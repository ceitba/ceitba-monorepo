// Push transport (service/push/PushGateway + FirebasePushGateway, config/PushConfig).
// A gateway exists only when FIREBASE_SERVICE_ACCOUNT_JSON (raw or base64) or
// _PATH is set; otherwise `createPushGateway` returns null and the push feature
// uses its NoOp service (FCM push disabled). Tests inject FakePushGateway.

import { readFileSync } from 'node:fs';
import type { Config } from '../config';
// The message is the push feature's (service/push/PushMessage); the gateway only carries it.
import type { PushMessage } from '../features/push/logic/pushMessage';

export type { PushMessage };

export const MAX_TOKENS_PER_CALL = 500;
export type PushOutcome = 'SENT' | 'UNREGISTERED' | 'INVALID_ARGUMENT' | 'FAILED';

/** PushDeliveryException: the multicast call as a whole failed. */
export class PushDeliveryError extends Error {}

export interface PushGateway {
  /** One outcome per token, in order. Throws PushDeliveryError when the call fails. */
  send(tokens: string[], message: PushMessage): Promise<PushOutcome[]>;
  close?(): Promise<void>;
}

/**
 * FakePushGateway (src/test/java/.../service/push/FakePushGateway): records every
 * call, also the ones told to fail, and answers SENT unless a token was given
 * another outcome.
 */
export class FakePushGateway implements PushGateway {
  readonly calls: { tokens: string[]; message: PushMessage }[] = [];
  readonly outcomes = new Map<string, PushOutcome>();
  private readonly failing = new Set<number>();

  async send(tokens: string[], message: PushMessage): Promise<PushOutcome[]> {
    const index = this.calls.length;
    this.calls.push({ tokens: [...tokens], message });
    if (this.failing.has(index)) throw new PushDeliveryError('simulated failure');
    return tokens.map((t) => this.outcomes.get(t) ?? 'SENT');
  }

  answer(token: string, outcome: PushOutcome): this {
    this.outcomes.set(token, outcome);
    return this;
  }

  failCall(zeroBasedIndex: number): this {
    this.failing.add(zeroBasedIndex);
    return this;
  }

  allTokens(): string[] {
    return this.calls.flatMap((c) => c.tokens);
  }

  reset(): void {
    this.calls.length = 0;
    this.outcomes.clear();
    this.failing.clear();
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
