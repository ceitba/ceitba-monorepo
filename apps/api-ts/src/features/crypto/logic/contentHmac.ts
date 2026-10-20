// Port of apps/api/src/main/java/org/ceitba/api/service/crypto/ContentHmac.java.
//
// Keyed hashes over content identifiers and client IPs. Each purpose (label)
// has its own key, derived from a root secret as
//   key(label) = HMAC-SHA256(root, "ceitba-content-hmac:v1:" + label)
// Root: CONTENT_HMAC_SECRET (UTF-8 bytes, >= 32) when set and not blank, else
// the base64-decoded AUTH_JWT_SECRET. See the Java class for what rotating
// either secret breaks.
//
// TODO(crypto-service): build the singleton from config (auth.jwt.secret,
// content.hmac-secret) once src/config exposes them.

import { createHmac } from 'node:crypto';
import { javaBase64Decode, javaIsBlank, javaUtf8 } from '../../../lib/javaCompat';

export const PROPOSAL_ATTACHMENT_KEYS = 'proposal-attachment-keys';
export const FIRESTORE_COMMENT_IDS = 'firestore-comment-ids';
export const VOTE_FINGERPRINTS = 'vote-fingerprints';
export const ANALYTICS_IP_HASHES = 'analytics-ip-hashes';
/** Weekly digest one-click unsubscribe links (digest). */
export const DIGEST_UNSUBSCRIBE = 'digest-unsubscribe';
/** Weekly digest "¿Es así?" schedule-correction vote links (digest). */
export const DIGEST_CORRECTION_VOTE = 'digest-correction-vote';
/** In-memory rate-limit keys of the digest open pixel / click redirects (never stored). */
export const MAIL_TRACKING_IP = 'mail-tracking-ip';
/** One-click unsubscribe links of organizations' emails (orgmail). */
export const ORG_MAIL_UNSUBSCRIBE = 'org-mail-unsubscribe';

export const MIN_DEDICATED_SECRET_BYTES = 32;
const LABEL_PREFIX = 'ceitba-content-hmac:v1:';

/** Java's IllegalStateException from the constructor. */
export class ContentHmacConfigError extends Error {}

function hmac(key: Uint8Array, message: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(javaUtf8(message)).digest());
}

function rootSecret(base64JwtSecret: string | null | undefined, dedicatedSecret: string | null | undefined): Uint8Array {
  if (dedicatedSecret != null && !javaIsBlank(dedicatedSecret)) {
    const bytes = javaUtf8(dedicatedSecret);
    if (bytes.length < MIN_DEDICATED_SECRET_BYTES) {
      throw new ContentHmacConfigError(`content.hmac-secret must be at least ${MIN_DEDICATED_SECRET_BYTES} bytes`);
    }
    return bytes;
  }
  if (base64JwtSecret == null || javaIsBlank(base64JwtSecret)) {
    throw new ContentHmacConfigError('auth.jwt.secret (or content.hmac-secret) is required');
  }
  // Base64.getDecoder().decode: an invalid secret throws IllegalArgumentException in Java too.
  return javaBase64Decode(base64JwtSecret);
}

export class ContentHmac {
  private readonly root: Uint8Array;
  private readonly derived = new Map<string, Uint8Array>();

  /** new ContentHmac(AuthProperties, content.hmac-secret). */
  constructor(base64JwtSecret: string | null | undefined, dedicatedSecret?: string | null) {
    this.root = rootSecret(base64JwtSecret, dedicatedSecret);
  }

  static fromJwtSecret(base64JwtSecret: string): ContentHmac {
    return new ContentHmac(base64JwtSecret, null);
  }

  /** HMAC-SHA256 of `message` (UTF-8) under the key derived for `label`. */
  sign(label: string, message: string): Uint8Array {
    let key = this.derived.get(label);
    if (!key) {
      key = hmac(this.root, LABEL_PREFIX + label);
      this.derived.set(label, key);
    }
    return hmac(key, message);
  }

  /** Lower-case hex of sign(label, message), 64 chars. */
  signHex(label: string, message: string): string {
    return Buffer.from(this.sign(label, message)).toString('hex');
  }
}
