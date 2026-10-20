// Port of apps/api/src/test/java/org/ceitba/api/web/user/dto/RegisterDeviceRequestTest.java
// The token cap must match user_devices.token (VARCHAR(1024), V23): a longer
// token has to be a 400, not a database error.
import { describe, expect, test } from 'bun:test';
import { MAX_TOKEN_LENGTH, RegisterDeviceRequest } from '../../src/features/user/logic/registerDeviceRequest';
import { INTEROP } from '../interop/java-golden';
import { violations } from '../staff/support/violations';

describe('RegisterDeviceRequestTest', () => {
  test('tokenIsCappedAt1024Characters', () => {
    expect(MAX_TOKEN_LENGTH).toBe(1024);
    expect(violations(RegisterDeviceRequest, { token: 't'.repeat(1024), platform: 'ios', appVersion: null })).toEqual([]);
    const v = violations(RegisterDeviceRequest, { token: 't'.repeat(1025), platform: 'ios', appVersion: null });
    expect(v).toHaveLength(1);
    expect(v[0]!.path).toBe('token');
  });
});

describe('interop: RegisterDeviceRequest violations against Hibernate Validator', () => {
  test('same paths and messages for a matrix of requests', () => {
    for (const c of INTEROP.validation?.registerDevice ?? []) {
      expect(violations(RegisterDeviceRequest, c.input)).toEqual(c.violations);
    }
  });
});

describe('interop: Spring interpolates with the request locale (Accept-Language: es-AR)', () => {
  test('LocalValidatorFactoryBean + LocaleContextHolder es-AR gives the Spanish bundle', () => {
    // What Java answers for {"token":"","platform":"web"} under es-AR; the TS schemas
    // produce the English messages (TODO(http): locale-aware validateBody).
    expect(INTEROP.validation.springEsAR).toEqual([
      { path: 'platform', message: 'debe coincidir con "(?i)ios|android"' },
      { path: 'token', message: 'debe coincidir con "[A-Za-z0-9_:.\\-]+"' },
      { path: 'token', message: 'no debe estar vacío' },
    ]);
  });
});
