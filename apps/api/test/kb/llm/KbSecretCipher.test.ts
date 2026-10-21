// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/KbSecretCipherTest.java
// (+ ciphertexts produced by the Java implementation, decrypted here).
import { describe, expect, test } from 'bun:test';
import { toJavaJson } from '../../../src/lib/json';
import { KbSecretCipher, KeyUnreadableError } from '../../../src/features/kb/logic/llm/kbSecretCipher';
import { Odt } from '../../../src/features/kb/logic/odt';
import { item } from '../../../src/features/kb/logic/web/kbEndpointDtos';

const ENV_KEY = Buffer.alloc(32).toString('base64');

describe('KbSecretCipherTest', () => {
  test('roundTripsWithTheJwtDerivedKeyAndNeverShowsThePlaintext', () => {
    const c = new KbSecretCipher('', 'jwt-secret-of-the-api');
    const stored = c.encrypt('sk-my-gpu-token');
    expect(stored.startsWith('v1:jwt:')).toBe(true);
    expect(stored).not.toContain('sk-my-gpu-token');
    expect(c.encrypt('sk-my-gpu-token')).not.toBe(stored); // random IV
    expect(c.decrypt(stored)).toBe('sk-my-gpu-token');

    // The API item only says hasKey / keyReadable.
    const now = Odt.ofEpochMilli(Date.now());
    const out = toJavaJson(item(crypto.randomUUID(), 'gpu', 'http://h/v1', true, c.readable(stored), 2, 600, true, 0, now, now));
    expect(out).toContain('"hasKey":true');
    expect(out).not.toContain('sk-my-gpu-token');
    expect(out).not.toContain('apiKey');
  });

  test('oldTokensSurviveSettingTheEnvKeyAndRotationMakesThemUnreadable', () => {
    const jwtOnly = new KbSecretCipher('', 'jwt-secret-of-the-api');
    const old = jwtOnly.encrypt('tok');

    const withEnv = new KbSecretCipher(ENV_KEY, 'jwt-secret-of-the-api');
    expect(withEnv.decrypt(old)).toBe('tok');
    expect(withEnv.encrypt('tok2').startsWith('v1:env:')).toBe(true);

    const rotated = new KbSecretCipher('', 'another-secret');
    expect(rotated.readable(old)).toBe(false);
    expect(() => rotated.decrypt(old)).toThrow(KeyUnreadableError);
    expect(() => rotated.decrypt(old)).toThrow('re-enter');
    expect(rotated.readable(null)).toBe(true);
  });
});

// Not in the Java suite: byte compatibility with values the Java KbSecretCipher wrote
// (a throwaway main against apps/api/target/classes, JDK 21).
describe('KbSecretCipher Java compatibility', () => {
  test('decryptsJavaCiphertexts', () => {
    const jwt = 'v1:jwt:D0nhyGGYGwU1DLFyuiii92ugAXxAhjeyAbZjbHqe0nY96SxyV+sIJvF+k1cVVTB0WRg8QwSk7g==';
    const env = 'v1:env:mWYDCMAmf36Dkx2SCtB1mzVdPhVm7aDnijCuUp/FCeMQa4lcd5ypUQ==';
    expect(new KbSecretCipher('', 'jwt-secret-of-the-api').decrypt(jwt)).toBe('sk-my-gpu-token ñandú €');
    expect(new KbSecretCipher(ENV_KEY, 'jwt-secret-of-the-api').decrypt(env)).toBe('sk-env-token');
    expect(new KbSecretCipher('', 'jwt-secret-of-the-api').readable(env)).toBe(false);
  });
});
