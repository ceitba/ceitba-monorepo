// Port of apps/api/src/test/java/org/ceitba/api/service/media/S3ObjectStorageTest.java
// against the shared src/infra/storage.ts S3ObjectStorage and the integrations
// config section: real SigV4 presigning with dummy credentials (local, no bucket).
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { MutableClock } from '../../src/infra/clock';
import { S3ObjectStorage } from '../../src/infra/storage';

const config = (env: Record<string, string>) => loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/none', ...env });
const PROPS = {
  STORAGE_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com', STORAGE_BUCKET: 'ceitba-media',
  STORAGE_ACCESS_KEY_ID: 'AKIDTEST', STORAGE_SECRET_ACCESS_KEY: 'secret-test',
  STORAGE_PUBLIC_URL: 'https://media.example.org/', STORAGE_PRESIGN_TTL: 'PT5M',
};

async function storage() {
  const c = await config(PROPS);
  return new S3ObjectStorage(c.integrations.storage, new MutableClock('2026-01-01T00:00:00Z'));
}

describe('S3ObjectStorageTest', () => {
  test('presignPut_signsPathStyleUrlWithTypeAndLength', async () => {
    const up = await (await storage()).presignPut('proposals/abc/file.pdf', 'application/pdf', 1234);
    const url = new URL(up.uploadUrl);
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/ceitba-media/proposals/abc/file.pdf');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toBeString();
    expect(up.headers).toEqual({ 'Content-Length': '1234', 'Content-Type': 'application/pdf' });
    expect(up.headers.Host).toBeUndefined();
    expect(up.expiresAtMicros).toBe(Date.parse('2026-01-01T00:05:00Z') * 1000);
  });

  test('publicUrl_joinsBaseWithoutDoubleSlash', async () => {
    expect((await storage()).publicUrl('media/x.png')).toBe('https://media.example.org/media/x.png');
  });

  test('propertiesDefaults', async () => {
    const p = (await config({ STORAGE_ENDPOINT: 'e', STORAGE_REGION: ' ', STORAGE_BUCKET: 'b', STORAGE_ACCESS_KEY_ID: 'k', STORAGE_SECRET_ACCESS_KEY: 's', STORAGE_PUBLIC_URL: 'u' })).integrations.storage;
    expect(p.region).toBe('us-east-1');
    expect(p.presignTtlMs).toBe(10 * 60_000);
    expect(p.configured).toBe(true);
    expect((await config({})).integrations.storage.configured).toBe(false);
  });
});
