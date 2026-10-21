// In-process port of apps/api/src/test/java/org/ceitba/api/web/media/MinioPresignedUploadIT.java:
// the production upload path with the real pieces,
//
//   phone --PUT presigned URL--> Caddy (/ceitba-media/*) --> MinIO
//   phone --GET public URL-----> Caddy (/ceitba-media/*) --> MinIO (anonymous)
//
// The MinIO and mc images and the bucket/user setup script are read from
// apps/api/docker-compose.yml (minio, minio-init), the Caddy image from
// infra/caddy/docker-compose.yml and the route is the `handle /ceitba-media/*`
// block of infra/caddy/Caddyfile, so this breaks if either drifts. The API signs
// for the proxy's address while MinIO listens as ceitba-minio:9000: the
// signature validates only because Caddy forwards the Host header unchanged.
// Containers are started with the docker CLI (Testcontainers in Java); the test
// is skipped when Docker or one of the images is not available locally (it
// never pulls). Not black-box: it needs storage env pointing at containers it
// starts, and server-side S3ObjectStorage calls.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff } from '../../contract/support/identity';
import { supports } from '../../contract/support/routes';
import { MutableClock } from '../../src/infra/clock';
import { S3ObjectStorage } from '../../src/infra/storage';
import { testApp, type TestApp } from '../support/app';

const REPO = join(import.meta.dir, '..', '..', '..', '..');
const BUCKET = 'ceitba-media';
const ROOT_USER = 'ceitba-root';
const ROOT_PASSWORD = 'root-password-for-tests';
// Same name as the policy, as in .env.example: the script must not mistake the user name for an attached policy.
const SERVICE_KEY = 'ceitba-api';
const SERVICE_SECRET = 'service-secret-for-tests';

type Svc = { image: string; command?: string[] | string; entrypoint?: string[] };
const service = (file: string, name: string): Svc => {
  const doc = Bun.YAML.parse(readFileSync(join(REPO, file), 'utf8')) as { services: Record<string, Svc> };
  const s = doc.services[name];
  if (!s) throw new Error(`${name} in ${file}`);
  return s;
};
const minioSvc = service('apps/api/docker-compose.yml', 'minio');
const initSvc = service('apps/api/docker-compose.yml', 'minio-init');
const caddyImage = service('infra/caddy/docker-compose.yml', 'caddy').image;

function caddyMediaBlock(): string {
  const m = /^(\s*)handle \/ceitba-media\/\* \{[\s\S]*?^\1\}/m.exec(readFileSync(join(REPO, 'infra/caddy/Caddyfile'), 'utf8'));
  if (!m) throw new Error('handle /ceitba-media/* block in the Caddyfile');
  return m[0];
}

function docker(args: string[], allowFail = false): string {
  const p = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0 && !allowFail) throw new Error(`docker ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}
const dockerOk = (() => {
  try {
    if (Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode !== 0) return false;
    return [minioSvc.image, initSvc.image, caddyImage].every((img) => Bun.spawnSync(['docker', 'image', 'inspect', img], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0);
  } catch {
    return false;
  }
})();

const hasProposalUpload = await supports('POST /v1/proposals/attachments/sign-upload');
const tag = `ceitba-it-${process.pid}-${Date.now().toString(36)}`;
let proxyBase = '';
let internal = '';
let caddyDir = '';
let t: TestApp;

const randomBytes = (n: number): Uint8Array<ArrayBuffer> => {
  // Deterministic like new Random(n).nextBytes.
  const b = new Uint8Array(new ArrayBuffer(n));
  let x = n * 2654435761 >>> 0;
  for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 0xff; }
  return b;
};

async function waitFor(url: string, ok: (s: number) => boolean, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (ok(r.status)) return;
    } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`${url} not ready`);
    await Bun.sleep(250);
  }
}

function runInit() {
  const script = (Array.isArray(initSvc.command) ? initSvc.command : [initSvc.command!]).map((s) => s.replaceAll('$$', '$'));
  docker(['run', '--rm', '--network', tag,
    '-e', 'MC_CONFIG_DIR=/tmp/.mc', '-e', 'MINIO_URL=http://minio:9000', '-e', `MINIO_ROOT_USER=${ROOT_USER}`, '-e', `MINIO_ROOT_PASSWORD=${ROOT_PASSWORD}`,
    '-e', `STORAGE_BUCKET=${BUCKET}`, '-e', `STORAGE_ACCESS_KEY_ID=${SERVICE_KEY}`, '-e', `STORAGE_SECRET_ACCESS_KEY=${SERVICE_SECRET}`,
    '--entrypoint', initSvc.entrypoint![0]!, initSvc.image, ...initSvc.entrypoint!.slice(1), ...script]);
}

const port = (container: string, p: number) => docker(['port', container, `${p}/tcp`]).split('\n')[0]!.replace('0.0.0.0', '127.0.0.1');

beforeAll(async () => {
  if (!dockerOk) return;
  docker(['network', 'create', tag]);
  const cmd = Array.isArray(minioSvc.command) ? minioSvc.command : String(minioSvc.command).split(' ');
  docker(['run', '-d', '--name', `${tag}-minio`, '--network', tag, '--network-alias', 'ceitba-minio', '--network-alias', 'minio',
    '-e', `MINIO_ROOT_USER=${ROOT_USER}`, '-e', `MINIO_ROOT_PASSWORD=${ROOT_PASSWORD}`, '-p', '127.0.0.1::9000', minioSvc.image, ...cmd]);
  internal = `http://${port(`${tag}-minio`, 9000)}`;
  await waitFor(`${internal}/minio/health/live`, (s) => s === 200);
  runInit();
  // Run it again: `docker compose up` does so on every deploy.
  runInit();
  caddyDir = mkdtempSync(join(tmpdir(), 'caddy-it-'));
  writeFileSync(join(caddyDir, 'Caddyfile'), `:80 {\n${caddyMediaBlock()}\n}\n`);
  docker(['run', '-d', '--name', `${tag}-caddy`, '--network', tag, '-p', '127.0.0.1::80', '-v', `${join(caddyDir, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, caddyImage]);
  proxyBase = `http://${port(`${tag}-caddy`, 80)}`;
  await waitFor(`${proxyBase}/`, () => true);
  // What prod sets, with ceitba.org.ar replaced by the proxy's address.
  t = await testApp({ env: {
    STORAGE_ENDPOINT: proxyBase, STORAGE_BUCKET: BUCKET, STORAGE_ACCESS_KEY_ID: SERVICE_KEY,
    STORAGE_SECRET_ACCESS_KEY: SERVICE_SECRET, STORAGE_PUBLIC_URL: `${proxyBase}/${BUCKET}`,
  } });
  await seedStaff(t.sql, 'boss@itba.edu.ar');
}, 180_000);

afterAll(async () => {
  if (!dockerOk) return;
  await t?.close();
  docker(['rm', '-f', `${tag}-caddy`, `${tag}-minio`], true);
  docker(['network', 'rm', tag], true);
  if (caddyDir) rmSync(caddyDir, { recursive: true, force: true });
});

const auth = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });

async function sign(path: string, contentType: string, size: number, email: string) {
  const r = await t.request('POST', path, { headers: await auth(email), body: { filename: 'f', contentType, sizeBytes: size } });
  expect(r.status).toBe(200);
  return r.json as { uploadUrl: string; publicUrl: string; key: string; method: string; headers: Record<string, string> };
}

/** The upload as the mobile app sends it: method + every returned header. */
async function upload(signed: Awaited<ReturnType<typeof sign>>, bytes: Uint8Array<ArrayBuffer>, overrides: Record<string, string> = {}) {
  expect(signed.headers['Content-Length']).toBe(String(bytes.length));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(signed.headers)) if (k.toLowerCase() !== 'content-length') headers[k] = overrides[k] ?? v;
  return fetch(signed.uploadUrl, { method: signed.method, body: bytes, headers });
}

const get = (url: string) => fetch(url);
const serviceStorage = (withInternal: boolean) => new S3ObjectStorage({
  endpoint: proxyBase, region: 'us-east-1', bucket: BUCKET, accessKeyId: SERVICE_KEY, secretAccessKey: SERVICE_SECRET,
  publicBaseUrl: `${proxyBase}/${BUCKET}`, presignTtlMs: 5 * 60_000, internalEndpoint: withInternal ? internal : '', configured: true,
}, new MutableClock());

describe.skipIf(!dockerOk)('MinioPresignedUploadIT', () => {
  test('staffImage_presignedPutThroughProxy_thenAnonymousGet', async () => {
    const png = randomBytes(4096);
    const signed = await sign('/v1/media/sign-upload', 'image/png', png.length, 'boss@itba.edu.ar');
    expect(signed.uploadUrl.startsWith(`${proxyBase}/${BUCKET}/${signed.key}?`)).toBe(true);
    expect(signed.publicUrl).toBe(`${proxyBase}/${BUCKET}/${signed.key}`);
    // Nothing there yet.
    expect([403, 404]).toContain((await get(signed.publicUrl)).status);
    const put = await upload(signed, png);
    expect(put.status).toBe(200);
    const got = await get(signed.publicUrl);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
    expect(got.headers.get('Content-Type')).toContain('image/png');
  });

  test.skipIf(!hasProposalUpload)('proposalAttachment_roundTrip', async () => {
    const pdf = randomBytes(10_000);
    const r = await t.request('POST', '/v1/proposals/attachments/sign-upload', { headers: await auth('alumno@itba.edu.ar'), body: { filename: 'f', contentType: 'application/pdf', sizeBytes: pdf.length } });
    expect(r.status).toBe(200);
    expect((await upload(r.json, pdf)).status).toBe(200);
    const got = await get(r.json.publicUrl);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(pdf);
  });

  test('uploadsThatDoNotMatchTheSignatureAreRejected', async () => {
    const png = randomBytes(2048);
    const signed = await sign('/v1/media/sign-upload', 'image/png', png.length, 'boss@itba.edu.ar');
    // Unsigned PUT to the public URL (anonymous access is download only).
    expect((await fetch(signed.publicUrl, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } })).status).toBe(403);
    // A different content type than the one signed.
    expect((await upload(signed, png, { 'Content-Type': 'text/html' })).status).toBe(403);
    // A different length than the one signed (Content-Length is signed).
    expect((await fetch(signed.uploadUrl, { method: 'PUT', body: randomBytes(png.length + 1), headers: { 'Content-Type': 'image/png' } })).status).toBe(403);
    expect([403, 404]).toContain((await get(signed.publicUrl)).status);
  });

  test('anonymousCannotListTheBucket', async () => {
    for (const url of [`${proxyBase}/${BUCKET}/`, `${proxyBase}/${BUCKET}/?list-type=2`]) {
      const r = await get(url);
      expect(r.status).toBe(403);
      expect(await r.text()).not.toContain('ListBucketResult');
    }
    // Bare /ceitba-media is outside the Caddy route, so it never reaches MinIO either.
    expect(await (await get(`${proxyBase}/${BUCKET}?list-type=2`)).text()).not.toContain('ListBucketResult');
  });

  // The service user can put and get, nothing else: a correctly signed DELETE is refused by its policy.
  test('serviceUserCannotDelete', async () => {
    const png = randomBytes(512);
    const signed = await sign('/v1/media/sign-upload', 'image/png', png.length, 'boss@itba.edu.ar');
    expect((await upload(signed, png)).status).toBe(200);
    const s3 = new S3Client({ endpoint: proxyBase, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: SERVICE_KEY, secretAccessKey: SERVICE_SECRET } });
    const del = await getSignedUrl(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: signed.key }), { expiresIn: 300 });
    expect((await fetch(del, { method: 'DELETE' })).status).toBe(403);
    expect((await get(signed.publicUrl)).status).toBe(200);
  });

  // Caddy's request_body limit (12 MB) stops oversized bodies before MinIO, even with a valid signature.
  test('proxyRejectsBodiesOverTheLimit', async () => {
    const size = 13 * 1024 * 1024;
    const up = await serviceStorage(false).presignPut('media/too-big.bin', 'application/octet-stream', size);
    const r = await fetch(up.uploadUrl, { method: 'PUT', body: new Uint8Array(size), headers: { 'Content-Type': 'application/octet-stream' } });
    expect(r.status).toBe(413);
    expect([403, 404]).toContain((await get(`${proxyBase}/${BUCKET}/media/too-big.bin`)).status);
  });

  // Drive sync copies: written server side to MinIO (internal endpoint), never
  // anonymously readable, served only by signed GETs, deletable by the service
  // user (which can also delete kb/ payloads, nothing else).
  test('driveObjects_serverSidePutSignedGetDelete_neverAnonymous', async () => {
    const storage = serviceStorage(true);
    const pdf = randomBytes(20_000);
    const key = 'drive/1AbCdEf/0123456789abcdef/original.pdf';
    await storage.put(key, 'application/pdf', pdf);
    // Above Caddy's upload limit: the internal path.
    await storage.put('drive/1AbCdEf/0123456789abcdef/big.bin', 'application/octet-stream', randomBytes(13 * 1024 * 1024));

    expect((await get(storage.publicUrl(key))).status).toBe(403);
    const signed = await storage.presignGet(key, 5 * 60_000, { filename: 'Apunte ñ.pdf' });
    expect(signed.startsWith(`${proxyBase}/${BUCKET}/${key}?`)).toBe(true);
    const got = await get(signed);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(pdf);
    const cd = got.headers.get('Content-Disposition')!;
    expect(cd.startsWith('attachment;')).toBe(true);
    expect(cd).toContain("filename*=UTF-8''Apunte%20%C3%B1.pdf");

    await storage.delete(key);
    await storage.delete('drive/1AbCdEf/0123456789abcdef/big.bin');
    expect((await get(await storage.presignGet(key, 5 * 60_000))).status).toBe(404);
    await storage.delete(key); // deleting a missing object is fine

    // Outside drive/ and kb/ the service user still cannot delete.
    const png = randomBytes(256);
    const up = await sign('/v1/media/sign-upload', 'image/png', png.length, 'boss@itba.edu.ar');
    expect((await upload(up, png)).status).toBe(200);
    await expect(storage.delete(up.key)).rejects.toBeDefined();
    expect((await get(up.publicUrl)).status).toBe(200);
  }, 60_000);
});
