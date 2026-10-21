// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailTokenCipher.java.
//
// AES-256-GCM for OAuth refresh tokens at rest. Output: base64 of
// version(1) | iv(12) | ciphertext+tag(16). `aad` (the account email, lower
// case) is authenticated, so a ciphertext copied to another row does not
// decrypt. Key: MAIL_TOKEN_ENCRYPTION_KEY, 32 bytes in base64. Never log
// plaintexts or ciphertexts.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { base64Encode, JavaIllegalArgument, javaBase64Decode, javaTrim, javaUtf8 } from '../../../lib/javaCompat';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The IllegalStateException of the constructor (bad key) and of encrypt. */
export class MailTokenCipherConfigError extends Error {}

/** MailTokenCipher.TokenDecryptionException: tampering, a wrong key or a wrong aad. */
export class TokenDecryptionError extends Error {}

export class MailTokenCipher {
  private readonly key: Uint8Array;

  constructor(base64Key: string | null | undefined) {
    let raw: Uint8Array;
    try {
      raw = javaBase64Decode(base64Key == null ? '' : javaTrim(base64Key));
    } catch (e) {
      if (e instanceof JavaIllegalArgument) throw new MailTokenCipherConfigError('MAIL_TOKEN_ENCRYPTION_KEY is not valid base64');
      throw e;
    }
    if (raw.length !== 32) {
      throw new MailTokenCipherConfigError('MAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64 (openssl rand -base64 32)');
    }
    this.key = raw;
  }

  encrypt(plaintext: string, aad: string | null): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aadBytes(aad));
    const ct = Buffer.concat([cipher.update(javaUtf8(plaintext)), cipher.final(), cipher.getAuthTag()]);
    return base64Encode(new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, ct])));
  }

  /** Throws TokenDecryptionError on tampering, a wrong key or a wrong aad. */
  decrypt(encoded: string, aad: string | null): string {
    let input: Uint8Array;
    try {
      input = javaBase64Decode(encoded);
    } catch (e) {
      if (e instanceof JavaIllegalArgument) throw new TokenDecryptionError('Stored token cannot be decrypted (tampered or wrong key)');
      throw e;
    }
    if (input.length < 1 + IV_BYTES + TAG_BYTES || input[0] !== VERSION) {
      throw new TokenDecryptionError('Unsupported token format');
    }
    const iv = input.subarray(1, 1 + IV_BYTES);
    const body = input.subarray(1 + IV_BYTES, input.length - TAG_BYTES);
    const tag = input.subarray(input.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aadBytes(aad));
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(body), decipher.final()]);
      // new String(pt, UTF_8): malformed bytes become U+FFFD.
      return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(pt);
    } catch {
      throw new TokenDecryptionError('Stored token cannot be decrypted (tampered or wrong key)');
    }
  }
}

function aadBytes(aad: string | null): Uint8Array {
  return javaUtf8(aad == null ? '' : aad.toLowerCase());
}
