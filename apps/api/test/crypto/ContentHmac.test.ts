// Port of apps/api/src/test/java/org/ceitba/api/service/crypto/ContentHmacTest.java
// (+ `interop:` tests with values produced by the Java class).
import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  ANALYTICS_IP_HASHES, ContentHmac, ContentHmacConfigError, FIRESTORE_COMMENT_IDS, PROPOSAL_ATTACHMENT_KEYS,
  VOTE_FINGERPRINTS,
} from '../../src/features/crypto/logic/contentHmac';
import { INTEROP } from '../interop/java-golden';

const JWT_SECRET = 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch';
const DEDICATED = 'a-dedicated-content-secret-of-32+-bytes';

// new ContentHmac(auth(jwtSecret), dedicated)
const make = (jwt: string | null, dedicated: string | null) => new ContentHmac(jwt, dedicated);

function rawHmac(key: Uint8Array, message: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(message, 'utf8').digest());
}

describe('ContentHmacTest', () => {
  test('neverUsesTheJwtSigningKeyDirectly', () => {
    const hmac = make(JWT_SECRET, '');
    const jwtKey = new Uint8Array(Buffer.from(JWT_SECRET, 'base64'));

    expect(hmac.sign(PROPOSAL_ATTACHMENT_KEYS, 'm')).not.toEqual(rawHmac(jwtKey, 'm'));
    expect(hmac.sign(FIRESTORE_COMMENT_IDS, 'm')).not.toEqual(rawHmac(jwtKey, 'm'));
    // The derivation documented in ContentHmac.
    const derived = rawHmac(jwtKey, `ceitba-content-hmac:v1:${PROPOSAL_ATTACHMENT_KEYS}`);
    expect(hmac.sign(PROPOSAL_ATTACHMENT_KEYS, 'm')).toEqual(rawHmac(derived, 'm'));
  });

  test('eachLabelHasItsOwnKeyAndResultsAreStable', () => {
    const hmac = ContentHmac.fromJwtSecret(JWT_SECRET);
    const a = hmac.sign(PROPOSAL_ATTACHMENT_KEYS, 'm');
    expect(a).not.toEqual(hmac.sign(FIRESTORE_COMMENT_IDS, 'm'));
    expect(a).toEqual(ContentHmac.fromJwtSecret(JWT_SECRET).sign(PROPOSAL_ATTACHMENT_KEYS, 'm'));
  });

  test('dedicatedSecretTakesPrecedenceOverTheJwtSecret', () => {
    const jwtOnly = make(JWT_SECRET, null);
    const dedicated = make(JWT_SECRET, DEDICATED);
    const dedicatedOtherJwt = make('b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25nIQ==', DEDICATED);

    const label = FIRESTORE_COMMENT_IDS;
    expect(dedicated.sign(label, 'm')).not.toEqual(jwtOnly.sign(label, 'm'));
    // Rotating the JWT secret does not change keys derived from a dedicated secret.
    expect(dedicatedOtherJwt.sign(label, 'm')).toEqual(dedicated.sign(label, 'm'));
    const derived = rawHmac(new TextEncoder().encode(DEDICATED), `ceitba-content-hmac:v1:${label}`);
    expect(dedicated.sign(label, 'm')).toEqual(rawHmac(derived, 'm'));
  });

  test('rejectsShortDedicatedSecretAndMissingSecrets', () => {
    expect(() => make(JWT_SECRET, 'too-short')).toThrow(ContentHmacConfigError);
    expect(() => make('', ' ')).toThrow(ContentHmacConfigError);
    // A dedicated secret alone is enough.
    expect(make(null, DEDICATED).sign('x', 'm')).toHaveLength(32);
  });

  test('signHexIsLowercaseHexOfSignAndClientIpLabelsUseSeparateKeys', () => {
    const hmac = ContentHmac.fromJwtSecret(JWT_SECRET);
    const hex = hmac.signHex(VOTE_FINGERPRINTS, '1.2.3.4|UA');

    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
    expect(new Uint8Array(Buffer.from(hex, 'hex')) as Uint8Array).toEqual(hmac.sign(VOTE_FINGERPRINTS, '1.2.3.4|UA'));
    expect(hmac.signHex(ANALYTICS_IP_HASHES, '1.2.3.4')).not.toBe(hmac.signHex(VOTE_FINGERPRINTS, '1.2.3.4'));
  });
});

describe('interop: ContentHmac against Java', () => {
  test('signHex of every label, JWT root and dedicated root', () => {
    const jwt = ContentHmac.fromJwtSecret(JWT_SECRET);
    const ded = make(JWT_SECRET, DEDICATED);
    for (const [label, msg, jwtHex, dedHex] of INTEROP.contentHmac) {
      expect(jwt.signHex(label, msg)).toBe(jwtHex);
      expect(ded.signHex(label, msg)).toBe(dedHex);
    }
  });
});
