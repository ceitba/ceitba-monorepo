// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestUnsubscribeTokens.java.
//
// One-click unsubscribe tokens: "<userId>.<base64url HMAC>". The key is
// ContentHmac's DIGEST_UNSUBSCRIBE purpose key. Tokens do not expire (old
// emails keep working); rotating the root secret invalidates them.

import { timingSafeEqual } from 'node:crypto';
import { base64UrlEncode, CANONICAL_UUID, JavaIllegalArgument, javaBase64Decode } from '../../../lib/javaCompat';
import { DIGEST_UNSUBSCRIBE, type ContentHmac } from '../../crypto/logic/contentHmac';

const MESSAGE_PREFIX = 'digest-unsubscribe:v1:';

/** MessageDigest.isEqual: constant time for equal lengths, false otherwise. */
export function macEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export class DigestUnsubscribeTokens {
  constructor(private readonly hmac: ContentHmac) {}

  issue(userId: string): string {
    return `${userId}.${base64UrlEncode(this.mac(userId))}`;
  }

  /** The user id, or null (Optional.empty()). */
  verify(token: string | null | undefined): string | null {
    if (token == null) return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
    const idPart = token.slice(0, dot);
    let given: Uint8Array;
    try {
      given = javaBase64Decode(token.slice(dot + 1), true);
    } catch (e) {
      if (e instanceof JavaIllegalArgument) return null;
      throw e;
    }
    // Canonical form only (UUID.fromString accepts odd spellings, which then fail toString().equals).
    if (!CANONICAL_UUID.test(idPart)) return null;
    return macEquals(this.mac(idPart), given) ? idPart : null;
  }

  private mac(userId: string): Uint8Array {
    return this.hmac.sign(DIGEST_UNSUBSCRIBE, MESSAGE_PREFIX + userId);
  }
}
