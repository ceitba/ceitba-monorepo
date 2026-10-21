// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailTokenCipherTest.java
// (+ `interop:` decrypting a blob encrypted by the Java class).
import { describe, expect, test } from 'bun:test';
import { MailTokenCipher, MailTokenCipherConfigError, TokenDecryptionError } from '../../src/features/mail/logic/mailTokenCipher';
import { INTEROP } from '../interop/java-golden';

const KEY = Buffer.alloc(32).toString('base64');
const OTHER_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const cipher = new MailTokenCipher(KEY);

describe('MailTokenCipherTest', () => {
  test('roundTripWithFreshIvEachTime', () => {
    const a = cipher.encrypt('1//refresh-token', 'ceitba@itba.edu.ar');
    const b = cipher.encrypt('1//refresh-token', 'ceitba@itba.edu.ar');
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(cipher.decrypt(a, 'ceitba@itba.edu.ar')).toBe('1//refresh-token');
    expect(cipher.decrypt(a, 'CEITBA@itba.edu.ar')).toBe('1//refresh-token'); // aad is case-insensitive
  });

  test('tamperingWrongKeyAndWrongAccountAreRejected', () => {
    const enc = cipher.encrypt('secret', 'ceitba@itba.edu.ar');
    const raw = Buffer.from(enc, 'base64');
    raw[raw.length - 1]! ^= 1;
    const tampered = raw.toString('base64');
    expect(() => cipher.decrypt(tampered, 'ceitba@itba.edu.ar')).toThrow(TokenDecryptionError);
    expect(() => new MailTokenCipher(OTHER_KEY).decrypt(enc, 'ceitba@itba.edu.ar')).toThrow(TokenDecryptionError);
    expect(() => cipher.decrypt(enc, 'someone@itba.edu.ar')).toThrow(TokenDecryptionError);
    expect(() => cipher.decrypt('not base64 !', 'x')).toThrow(TokenDecryptionError);
  });

  test('keyMustBe32Bytes', () => {
    expect(() => new MailTokenCipher(Buffer.alloc(16).toString('base64'))).toThrow(MailTokenCipherConfigError);
    expect(() => new MailTokenCipher('')).toThrow(MailTokenCipherConfigError);
  });
});

describe('interop: MailTokenCipher against Java', () => {
  test('decrypts what Java encrypted, with the same error messages', () => {
    const g = INTEROP.mailCipher;
    const c = new MailTokenCipher(g.key);
    expect(c.decrypt(g.encrypted, g.aad)).toBe(g.plaintext);
    for (const [enc, aad, message] of g.errors) {
      expect(() => c.decrypt(enc, aad)).toThrow(message);
    }
  });
});
