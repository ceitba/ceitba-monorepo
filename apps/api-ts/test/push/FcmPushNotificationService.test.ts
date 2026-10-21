// Port of apps/api/src/test/java/org/ceitba/api/service/push/FcmPushNotificationServiceTest.java:
// batching and dead-token pruning of the FCM sender, against a fake gateway
// (Mockito's UserDeviceRepository mock -> a recording PushDevices fake).
import { beforeEach, describe, expect, test } from 'bun:test';
import { silentLogger } from '../../src/infra/logger';
import { FcmPushNotificationService, NoOpPushNotificationService, PUSH_RESULT_NONE, pushForResource, type PushDevices } from '../../src/features/push/service';
import { FakePushGateway } from './support/FakePushGateway';

const MSG = pushForResource('CEITBA', 'Nueva nota', 'article', 'a1');

class FakeDevices implements PushDevices {
  byUsers: string[] = [];
  followers = new Map<string, string[]>();
  all: string[] = [];
  deleted: string[][] = [];
  touched = false;
  async findTokensByUserIds() { this.touched = true; return this.byUsers; }
  async findTokensOfOrgFollowers(slug: string) { this.touched = true; return this.followers.get(slug) ?? []; }
  async findAllTokens() { this.touched = true; return this.all; }
  async deleteByTokens(tokens: string[]) { this.touched = true; this.deleted.push([...tokens]); return tokens.length; }
  /** verify(devices).deleteByTokens(captor.capture()): exactly one call. */
  pruned(): string[] {
    expect(this.deleted).toHaveLength(1);
    return this.deleted[0]!;
  }
}

const tokens = (n: number) => Array.from({ length: n }, (_, i) => `tok-${i}`);

let gateway: FakePushGateway;
let devices: FakeDevices;
let service: FcmPushNotificationService;

describe('FcmPushNotificationServiceTest', () => {
  beforeEach(() => {
    gateway = new FakePushGateway();
    devices = new FakeDevices();
    service = new FcmPushNotificationService(gateway, devices, silentLogger);
  });

  test('splitsIntoBatchesOfAtMost500', async () => {
    devices.all = tokens(1201);
    const result = await service.broadcast(MSG);
    expect(gateway.calls().map((c) => c.tokens.length)).toEqual([500, 500, 201]);
    expect(new Set(gateway.allTokens()).size).toBe(1201);
    expect(gateway.allTokens()).toHaveLength(1201);
    expect(result).toEqual({ targeted: 1201, sent: 1201, pruned: 0 });
    expect(devices.deleted).toHaveLength(0);
  });

  test('prunesUnregisteredAndInvalidTokensButKeepsTransientFailures', async () => {
    devices.followers.set('it', ['ok', 'gone', 'bad', 'flaky']);
    gateway.answer('gone', 'UNREGISTERED').answer('bad', 'INVALID_ARGUMENT').answer('flaky', 'FAILED');
    const result = await service.sendToOrgFollowers('it', MSG);
    expect([...devices.pruned()].sort()).toEqual(['bad', 'gone']);
    expect(result).toEqual({ targeted: 4, sent: 1, pruned: 2 });
  });

  test('aBatchRejectedEntirelyWithInvalidArgumentIsTreatedAsABadMessage', async () => {
    devices.all = ['a', 'b'];
    gateway.answer('a', 'INVALID_ARGUMENT').answer('b', 'INVALID_ARGUMENT');
    const result = await service.broadcast(MSG);
    expect(devices.deleted).toHaveLength(0);
    expect(result).toEqual({ targeted: 2, sent: 0, pruned: 0 });
  });

  test('anInvalidTokenIsPrunedWhenItIsTheOnlyTokenOfTheBatch', async () => {
    devices.byUsers = ['bad'];
    gateway.answer('bad', 'INVALID_ARGUMENT');
    const result = await service.sendToUsers([crypto.randomUUID()], MSG);
    expect(devices.pruned()).toEqual(['bad']);
    expect(result).toEqual({ targeted: 1, sent: 0, pruned: 1 });
  });

  test('unregisteredIsPrunedEvenWhenItIsTheOnlyToken', async () => {
    devices.byUsers = ['gone'];
    gateway.answer('gone', 'UNREGISTERED');
    await service.sendToUsers([crypto.randomUUID()], MSG);
    expect(devices.pruned()).toEqual(['gone']);
  });

  test('aFailedBatchIsSkippedAndTheRestStillGoOut', async () => {
    devices.all = tokens(700);
    gateway.failCall(0).answer('tok-600', 'UNREGISTERED');
    const result = await service.broadcast(MSG);
    expect(gateway.calls()).toHaveLength(2);
    expect(result).toEqual({ targeted: 700, sent: 199, pruned: 1 });
    expect(devices.pruned()).toEqual(['tok-600']);
  });

  test('duplicateTokensAreSentOnce', async () => {
    devices.all = ['x', 'x', 'y'];
    await service.broadcast(MSG);
    expect(gateway.allTokens()).toEqual(['x', 'y']);
  });

  test('noRecipientsMeansNoCalls', async () => {
    expect(await service.sendToOrgFollowers('nobody', MSG)).toEqual(PUSH_RESULT_NONE);
    expect(await service.sendToUsers([], MSG)).toEqual(PUSH_RESULT_NONE);
    expect(await service.sendToOrgFollowers(' ', MSG)).toEqual(PUSH_RESULT_NONE);
    expect(gateway.calls()).toHaveLength(0);
  });

  test('noOpServiceNeverTouchesAnything', async () => {
    const noop = new NoOpPushNotificationService();
    expect(await noop.broadcast(MSG)).toEqual(PUSH_RESULT_NONE);
    expect(await noop.sendToOrgFollowers('it', MSG)).toEqual(PUSH_RESULT_NONE);
    expect(await noop.sendToUsers([crypto.randomUUID()], MSG)).toEqual(PUSH_RESULT_NONE);
    expect(devices.touched).toBe(false);
  });
});
