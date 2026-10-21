// Ports of the Java config unit tests: PushConfigTest, JwtIssuerAudienceEnforcementTest
// (the property part; the decoder parts are in test/auth/units.test.ts), StorageEnvFallbackTest
// and MobileAppPropertiesTest. Same test names as the Java methods.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config';
import { mobileAppConfig } from '../../src/features/app/routes';
import { readServiceAccount } from '../../src/infra/push';

const base = { AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch' };
const push = (json: string, path: string) => ({ serviceAccountJson: json, serviceAccountPath: path });

describe('PushConfigTest', () => {
  test('notConfiguredWhenBothAreBlank', () => {
    expect(readServiceAccount(push('', ' '))).toBeNull();
    expect(readServiceAccount(push('{}', ''))).toBe('{}');
  });

  test('readsRawJson', () => {
    expect(readServiceAccount(push('  {"a":1}  ', ''))).toBe('{"a":1}');
  });

  test('readsBase64Json', () => {
    expect(readServiceAccount(push(Buffer.from('{"a":1}').toString('base64'), ''))).toBe('{"a":1}');
  });

  test('readsAFileAndJsonWinsOverPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-'));
    try {
      const f = join(dir, 'sa.json');
      writeFileSync(f, '{"file":true}');
      expect(readServiceAccount(push('', f))).toBe('{"file":true}');
      expect(readServiceAccount(push('{"env":true}', f))).toBe('{"env":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('JwtIssuerAudienceEnforcementTest', () => {
  test('enforcementIsOnWhenUnset', async () => {
    expect((await loadConfig(base)).auth.jwt.enforceIssuerAudience).toBe(true);
    expect((await loadConfig({ ...base, AUTH_JWT_ENFORCE_ISS_AUD: 'true' })).auth.jwt.enforceIssuerAudience).toBe(true);
    expect((await loadConfig({ ...base, AUTH_JWT_ENFORCE_ISS_AUD: 'false' })).auth.jwt.enforceIssuerAudience).toBe(false);
  });
});

describe('StorageEnvFallbackTest', () => {
  const storage = async (env: Record<string, string>) => (await loadConfig({ ...base, ...env })).integrations.storage;

  test('storageNamesWin', async () => {
    const s = await storage({
      STORAGE_ENDPOINT: 'https://ceitba.org.ar', R2_ENDPOINT: 'https://old.r2', STORAGE_BUCKET: 'ceitba-media',
      STORAGE_PUBLIC_URL: 'https://ceitba.org.ar/ceitba-media', STORAGE_PRESIGN_TTL: '5m',
    });
    expect([s.endpoint, s.bucket, s.publicBaseUrl, s.presignTtlMs, s.region])
      .toEqual(['https://ceitba.org.ar', 'ceitba-media', 'https://ceitba.org.ar/ceitba-media', 300_000, 'us-east-1']);
  });

  test('r2NamesAreFallbacks', async () => {
    const s = await storage({
      R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', R2_REGION: 'auto', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's', R2_PUBLIC_URL: 'https://media.test', R2_PRESIGN_TTL: '3m',
    });
    expect([s.endpoint, s.region, s.bucket, s.accessKeyId, s.secretAccessKey, s.publicBaseUrl, s.presignTtlMs])
      .toEqual(['https://acct.r2.cloudflarestorage.com', 'auto', 'b', 'k', 's', 'https://media.test', 180_000]);
  });

  test('unsetMeansEmpty', async () => {
    const s = await storage({});
    expect(s.endpoint).toBe('');
    expect(s.presignTtlMs).toBe(600_000);
  });
});

describe('MobileAppPropertiesTest', () => {
  const app = async (env: Record<string, string>) => mobileAppConfig(await loadConfig({ ...base, ...env }));

  test('defaultsWhenUnset', async () => {
    expect(await app({})).toEqual({ minVersion: '0.0.0', latestVersion: '0.0.0', maintenance: false });
  });

  test('latestDefaultsToMin', async () => {
    const p = await app({ MOBILE_MIN_VERSION: ' 1.3.0 ', MOBILE_LATEST_VERSION: '', MOBILE_MAINTENANCE: 'false' });
    expect([p.minVersion, p.latestVersion]).toEqual(['1.3.0', '1.3.0']);
  });
});
