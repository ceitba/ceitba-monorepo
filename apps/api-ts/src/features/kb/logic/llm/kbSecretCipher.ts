// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbSecretCipher.java.
//
// AES-256-GCM for secrets stored in the database (custom endpoint API keys).
// Key source: KB_SECRETS_KEY (optional override, base64 of 32 bytes) when set,
// else HKDF-SHA256(AUTH_JWT_SECRET, empty salt, info "ceitba-kb-endpoint-keys-v1",
// one 32-byte block), so no extra setup is needed and the JWT key itself is never used.
// Stored form: "v1:<env|jwt>:" + base64(iv(12) || ciphertext || tag(16)). The
// prefix says which source encrypted it, so setting KB_SECRETS_KEY later keeps
// old values readable. Rotating the key source makes old values unreadable
// (KeyUnreadableError): the owner must re-enter them. Never logs plaintext.
// Byte-compatible with the Java implementation in both directions.
// TODO(kb-service): one instance from config.kb.secretsKey and config.auth's JWT secret.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { jIsBlank, jSplit, jTrim } from '../javaString';

export class KeyUnreadableError extends Error {
  constructor() {
    super('The stored API key cannot be decrypted (AUTH_JWT_SECRET or KB_SECRETS_KEY changed): re-enter the token');
    this.name = 'KeyUnreadableException';
  }
}

const INFO = Buffer.from('ceitba-kb-endpoint-keys-v1', 'utf8');

/** java.util.Base64.getDecoder(): the standard alphabet, padding optional, no whitespace; else null. */
function base64Decode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const unpadded = s.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return null;
  if (s.includes('=') && s.length % 4 !== 0) return null;
  return Buffer.from(s, 'base64');
}

function parseKey(base64Key: string | null): Buffer | null {
  if (base64Key == null || jIsBlank(base64Key)) return null;
  const raw = base64Decode(jTrim(base64Key));
  return raw != null && raw.length === 32 ? raw : null;
}

/** HKDF-SHA256 (RFC 5869), empty salt (32 zero bytes as the HMAC key), one 32-byte block. */
function hkdf(ikm: Buffer): Buffer {
  const prk = createHmac('sha256', Buffer.alloc(32)).update(ikm).digest();
  return createHmac('sha256', prk).update(INFO).update(Buffer.from([1])).digest();
}

export class KbSecretCipher {
  private readonly envKey: Buffer | null;
  private readonly jwtKey: Buffer | null;

  constructor(base64Key: string | null, jwtSecret: string | null) {
    this.envKey = parseKey(base64Key);
    this.jwtKey = jwtSecret == null || jIsBlank(jwtSecret) ? null : hkdf(Buffer.from(jwtSecret, 'utf8'));
  }

  encrypt(plain: string): string {
    const source = this.envKey != null ? 'env' : 'jwt';
    const key = this.envKey ?? this.jwtKey;
    if (key == null) throw new Error('No encryption key available (AUTH_JWT_SECRET is empty)');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final(), c.getAuthTag()]);
    return `v1:${source}:${Buffer.concat([iv, ct]).toString('base64')}`;
  }

  /** null when nothing is stored; KeyUnreadableError when it cannot be decrypted. */
  decrypt(stored: string | null): string | null {
    if (stored == null || jIsBlank(stored)) return null;
    const parts = jSplit(stored, /:/, 3);
    if (parts.length !== 3 || parts[0] !== 'v1') throw new KeyUnreadableError();
    const key = parts[1] === 'env' ? this.envKey : parts[1] === 'jwt' ? this.jwtKey : null;
    if (key == null) throw new KeyUnreadableError();
    const input = base64Decode(parts[2]!);
    if (input == null || input.length < 12 + 16) throw new KeyUnreadableError();
    try {
      const d = createDecipheriv('aes-256-gcm', key, input.subarray(0, 12));
      d.setAuthTag(input.subarray(input.length - 16));
      const out = Buffer.concat([d.update(input.subarray(12, input.length - 16)), d.final()]);
      return out.toString('utf8');
    } catch {
      throw new KeyUnreadableError();
    }
  }

  readable(stored: string | null): boolean {
    if (stored == null || jIsBlank(stored)) return true;
    try {
      this.decrypt(stored);
      return true;
    } catch (e) {
      if (e instanceof KeyUnreadableError) return false;
      throw e;
    }
  }
}
