// Port of apps/api/src/test/java/org/ceitba/api/service/push/FirebasePushGatewayTest.java
// against the shared src/infra/push.ts FirebasePushGateway. No network. Java's
// MockHttpTransport (HTTP-level FCM answers) becomes a fake FirebaseMessaging
// answering sendEachForMulticast like firebase-admin does for the documented FCM
// errors (the HTTP/2 path itself was verified in spike 1, docs/plans/api-bun-spikes.md).
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { FirebasePushGateway, MAX_TOKENS_PER_CALL, PushDeliveryError } from '../../src/infra/push';
import { pushForResource } from '../../src/features/push/service';

function fakeServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account', project_id: 'demo-ceitba', private_key_id: 'k1',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    client_email: 'push@demo-ceitba.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://oauth2.googleapis.com/token',
  });
}

// firebase-admin error codes for FCM v1 errorCode UNREGISTERED / INVALID_ARGUMENT / QUOTA_EXCEEDED / SENDER_ID_MISMATCH.
const ERRORS: Record<string, string> = {
  dead: 'messaging/registration-token-not-registered',
  bad: 'messaging/invalid-argument',
  busy: 'messaging/message-rate-exceeded',
  other: 'messaging/mismatched-credential',
};

function fakeMessaging(bodies: unknown[]) {
  return {
    async sendEachForMulticast(m: { tokens: string[] }) {
      bodies.push(m);
      return {
        responses: m.tokens.map((t) => {
          const kind = t.split('-')[0]!;
          return ERRORS[kind] ? { success: false, error: { code: ERRORS[kind] } } : { success: true, messageId: 'projects/demo-ceitba/messages/1' };
        }),
      };
    },
  };
}

// The private constructor (app, messaging), as fromServiceAccount builds it.
const gatewayWith = (messaging: unknown) =>
  new (FirebasePushGateway as unknown as new (app: unknown, m: unknown) => FirebasePushGateway)({ delete: async () => {} }, messaging);

describe('FirebasePushGatewayTest', () => {
  test('mapsFcmErrorCodesToOutcomes', async () => {
    const gw = gatewayWith(fakeMessaging([]));
    expect(await gw.send(['dead-1', 'bad-1', 'other-1', 'busy-1', 'ok-1'], pushForResource('t', 'b', 'x', '1')))
      .toEqual(['UNREGISTERED', 'INVALID_ARGUMENT', 'FAILED', 'FAILED', 'SENT']);
  });

  test('buildsAMulticastMessage', async () => {
    const bodies: unknown[] = [];
    await gatewayWith(fakeMessaging(bodies)).send(['t1', 't2'], pushForResource('CEITBA', 'Hola', 'event', 'e1'));
    expect(bodies).toEqual([{
      tokens: ['t1', 't2'],
      notification: { title: 'CEITBA', body: 'Hola' },
      data: { type: 'event', id: 'e1' },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', contentAvailable: true } } },
    }]);
  });

  test('initializesFromAServiceAccountAndRejectsOversizedBatches', async () => {
    const gw = await FirebasePushGateway.fromServiceAccount(fakeServiceAccountJson());
    try {
      expect(await gw.send([], pushForResource('t', 'b', 'x', '1'))).toEqual([]);
      const tooMany = Array.from({ length: MAX_TOKENS_PER_CALL + 1 }, () => 't');
      await expect(gw.send(tooMany, pushForResource('t', 'b', 'x', '1'))).rejects.toThrow(`At most ${MAX_TOKENS_PER_CALL} tokens per call`);
    } finally {
      await gw.close();
    }
  });

  test('apnsPayloadIsContentAvailableSoIosCanRefreshTheInboxInTheBackground', async () => {
    const bodies: { apns: { payload: { aps: Record<string, unknown> } } }[] = [];
    await gatewayWith(fakeMessaging(bodies)).send(['ok-1'], pushForResource('CEITBA', 'Hola', 'article', 'a1'));
    expect(bodies).toHaveLength(1);
    // firebase-admin serializes contentAvailable as "content-available": 1.
    expect(bodies[0]!.apns.payload.aps).toEqual({ sound: 'default', contentAvailable: true });
  });

  test('sendsThroughFirebaseMessagingAndMapsPerTokenErrors', async () => {
    const bodies: unknown[] = [];
    const outcomes = await gatewayWith(fakeMessaging(bodies)).send(['ok-1', 'dead-1', 'bad-1', 'busy-1', 'ok-2'], pushForResource('CEITBA', 'Hola', 'article', 'a1'));
    expect(outcomes).toEqual(['SENT', 'UNREGISTERED', 'INVALID_ARGUMENT', 'FAILED', 'SENT']);
    expect(bodies).toHaveLength(1);
  });

  test('aWholeCallFailureIsAPushDeliveryError', async () => {
    const gw = gatewayWith({ async sendEachForMulticast() { throw Object.assign(new Error('x'), { code: 'app/invalid-credential' }); } });
    await expect(gw.send(['t'], pushForResource('t', 'b', 'x', '1'))).rejects.toBeInstanceOf(PushDeliveryError);
  });
});
