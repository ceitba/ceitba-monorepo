// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestUnsubscribeTokensTest.java
import { describe, expect, test } from 'bun:test';
import { ContentHmac, DIGEST_UNSUBSCRIBE, VOTE_FINGERPRINTS } from '../../src/features/crypto/logic/contentHmac';
import { DigestUnsubscribeTokens } from '../../src/features/digest/logic/digestUnsubscribeTokens';
import { INTEROP } from '../interop/java-golden';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const SECRET = TEST_JWT_SECRET;
const tokens = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret(SECRET));
const uuid = () => crypto.randomUUID();

describe('DigestUnsubscribeTokensTest', () => {
  test('roundTrip', () => {
    const id = uuid();
    expect(tokens.verify(tokens.issue(id))).toBe(id);
  });

  test('rejectsTamperedOrForeignTokens', () => {
    const id = uuid();
    const token = tokens.issue(id);
    const mac = token.slice(token.indexOf('.') + 1);
    // Same MAC, other user.
    expect(tokens.verify(`${uuid()}.${mac}`)).toBeNull();
    // Flipped MAC character.
    const c = mac[0] === 'A' ? 'B' : 'A';
    expect(tokens.verify(`${id}.${c}${mac.slice(1)}`)).toBeNull();
    // Signed with another secret.
    const other = new DigestUnsubscribeTokens(ContentHmac.fromJwtSecret('b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC0zMmJ5dGVz'));
    expect(tokens.verify(other.issue(id))).toBeNull();
  });

  test('rejectsMalformed', () => {
    expect(tokens.verify(null)).toBeNull();
    expect(tokens.verify('')).toBeNull();
    expect(tokens.verify('not-a-token')).toBeNull();
    expect(tokens.verify('x.y')).toBeNull();
    expect(tokens.verify(`${uuid()}.%%%`)).toBeNull();
    expect(tokens.verify(`${tokens.issue(uuid())}.extra`)).toBeNull();
  });

  test('notTheSameKeyAsOtherPurposes', () => {
    const hmac = ContentHmac.fromJwtSecret(SECRET);
    const id = uuid();
    expect(hmac.signHex(DIGEST_UNSUBSCRIBE, 'x')).not.toBe(hmac.signHex(VOTE_FINGERPRINTS, 'x'));
    expect(tokens.issue(id).startsWith(`${id}.`)).toBe(true);
  });
});

describe('interop: DigestUnsubscribeTokens against Java', () => {
  test('issues the same token as Java and verifies like Java', () => {
    const g = INTEROP.unsubscribe;
    expect(tokens.issue(g.userId)).toBe(g.token);
    for (const [input, expected] of g.verify) expect(tokens.verify(input)).toBe(expected);
  });
});
