// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestCorrectionVoteTokensTest.java
import { describe, expect, test } from 'bun:test';
import { MutableClock } from '../../src/infra/clock';
import { ContentHmac, DIGEST_CORRECTION_VOTE, DIGEST_UNSUBSCRIBE } from '../../src/features/crypto/logic/contentHmac';
import { DigestCorrectionVoteTokens } from '../../src/features/digest/logic/digestCorrectionVoteTokens';
import { DigestUnsubscribeTokens } from '../../src/features/digest/logic/digestUnsubscribeTokens';
import { INTEROP } from '../interop/java-golden';

const SECRET = 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch';
const NOW = Date.parse('2026-10-05T15:00:00Z') * 1000;
const DAYS_14 = 14 * 86_400_000;
const hmac = ContentHmac.fromJwtSecret(SECRET);
const uuid = () => crypto.randomUUID();

const at = (nowMicros: number) => new DigestCorrectionVoteTokens(hmac, new MutableClock(nowMicros, 'UTC'), DAYS_14);

describe('DigestCorrectionVoteTokensTest', () => {
  test('roundTripCarriesUserCorrectionAndExpiry', () => {
    const user = uuid();
    const correction = uuid();
    const v = at(NOW).verify(at(NOW).issue(user, correction));
    expect(v).toEqual({ type: 'Valid', userId: user, correctionId: correction, expiresAt: NOW + DAYS_14 * 1000 });
  });

  test('expiresAfterTheTtl', () => {
    const token = at(NOW).issue(uuid(), uuid());
    expect(at(NOW + DAYS_14 * 1000 - 1_000_000).verify(token).type).toBe('Valid');
    expect(at(NOW + DAYS_14 * 1000).verify(token).type).toBe('Expired');
  });

  test('rejectsTamperedForeignAndMalformedTokens', () => {
    const user = uuid();
    const correction = uuid();
    const token = at(NOW).issue(user, correction);
    const p = token.split('.') as [string, string, string, string];
    const tokens = at(NOW);
    // Other user, other correction, extended expiry: MAC no longer matches.
    expect(tokens.verify(`${uuid()}.${p[1]}.${p[2]}.${p[3]}`).type).toBe('Invalid');
    expect(tokens.verify(`${p[0]}.${uuid()}.${p[2]}.${p[3]}`).type).toBe('Invalid');
    expect(tokens.verify(`${p[0]}.${p[1]}.${Number(p[2]) + 86400}.${p[3]}`).type).toBe('Invalid');
    // An expired-looking forged token is Invalid, not Expired.
    expect(tokens.verify(`${p[0]}.${p[1]}.1.${p[3]}`).type).toBe('Invalid');
    // Another secret.
    const other = new DigestCorrectionVoteTokens(ContentHmac.fromJwtSecret('b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC0zMmJ5dGVz'),
      new MutableClock(NOW, 'UTC'), DAYS_14);
    expect(tokens.verify(other.issue(user, correction)).type).toBe('Invalid');
    for (const bad of [null, '', 'x', 'a.b.c.d', `${token}.x`, `${p[0]}.${p[1]}.-5.${p[3]}`,
      `${p[0].toUpperCase()}.${p[1]}.${p[2]}.${p[3]}`, `${p[0]}.${p[1]}.${p[2]}.%%%`]) {
      expect(tokens.verify(bad).type).toBe('Invalid');
    }
  });

  test('anUnsubscribeTokenIsNotAVoteToken', () => {
    const user = uuid();
    const unsub = new DigestUnsubscribeTokens(hmac).issue(user);
    expect(at(NOW).verify(unsub).type).toBe('Invalid');
    expect(hmac.signHex(DIGEST_CORRECTION_VOTE, 'x')).not.toBe(hmac.signHex(DIGEST_UNSUBSCRIBE, 'x'));
  });
});

describe('interop: DigestCorrectionVoteTokens against Java', () => {
  test('issues the same token as Java at the same instant and verifies like Java', () => {
    const g = INTEROP.vote;
    expect(at(NOW).issue(g.userId, g.correctionId)).toBe(g.token);
    for (const [input, expected] of g.verify) expect(at(NOW).verify(input).type).toBe(expected);
  });
});
