// Ports apps/api/src/test/java/org/ceitba/api/web/media/MediaEndpointsIT.java
// (storage not configured: 501) and StorageConfiguredUploadIT.java (dummy
// storage credentials: presigning is local SigV4, no bucket needed; per-user
// quota for proposal attachments). The proposal routes belong to the proposal
// feature and are skipped on ts until it lands.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, supports, useServer } from '../support';

const hasProposalUpload = await supports('POST /v1/proposals/attachments/sign-upload');
const hasProposals = await supports('POST /v1/proposals', 'POST /v1/proposals/attachments/sign-upload');

const as = async (email: string) => bearer(await mintJwt({ email, name: email }));

describe('MediaEndpointsIT', () => {
  const api = useServer();
  const staff = async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');
    return as('boss@itba.edu.ar');
  };
  const sign = async (path: string, who: Awaited<ReturnType<typeof as>> | undefined, body: string) => api.post(path, { as: who, body });

  test('signUpload_asUser_returns403', async () => {
    const r = await sign('/v1/media/sign-upload', await as('student@itba.edu.ar'), '{"filename":"a.png","contentType":"image/png","sizeBytes":1024}');
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('AccessDenied');
  });

  test.skipIf(!hasProposalUpload)('proposalAttachment_anonymous_returns401', async () => {
    const r = await sign('/v1/proposals/attachments/sign-upload', undefined, '{"filename":"a.pdf","contentType":"application/pdf","sizeBytes":1024}');
    expect(r.status).toBe(401);
  });

  test.skipIf(!hasProposalUpload)('proposalAttachment_withoutStorage_returns501', async () => {
    const r = await sign('/v1/proposals/attachments/sign-upload', await as('student@itba.edu.ar'), '{"filename":"a.pdf","contentType":"application/pdf","sizeBytes":1024}');
    expect(r.status).toBe(501);
    expect(r.json.error).toBe('NotImplemented');
  });

  test.skipIf(!hasProposalUpload)('proposalAttachment_validation_returns400', async () => {
    for (const body of [
      '{"filename":"a.gif","contentType":"image/gif","sizeBytes":1024}',
      '{"filename":"a.png","contentType":"image/png","sizeBytes":5242881}',
      '{"filename":"a.pdf","contentType":"application/pdf","sizeBytes":10485761}',
      '{"filename":"a.pdf","contentType":"application/pdf","sizeBytes":0}',
    ]) {
      const r = await sign('/v1/proposals/attachments/sign-upload', await as('student@itba.edu.ar'), body);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('ValidationError');
    }
  });

  test('signUpload_withoutStorage_returns501', async () => {
    const r = await sign('/v1/media/sign-upload', await staff(), '{"filename":"a.png","contentType":"image/png","sizeBytes":1024}');
    expect(r.status).toBe(501);
    expect(r.json.error).toBe('NotImplemented');
    expect(r.json.message).toBe('Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.');
  });

  test('signUpload_unsupportedType_returns400', async () => {
    const r = await sign('/v1/media/sign-upload', await staff(), '{"filename":"a.gif","contentType":"image/gif","sizeBytes":1024}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'contentType' with value 'image/gif': unsupported content type. Allowed: image/jpeg, image/png, image/webp");
  });

  test('signUpload_tooLarge_returns400', async () => {
    const r = await sign('/v1/media/sign-upload', await staff(), '{"filename":"a.png","contentType":"image/png","sizeBytes":10485760}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'sizeBytes' with value '10485760': file too large. Maximum size for image/png is 5 MB");
  });

  test('signUpload_beanValidation_returns400', async () => {
    const r = await sign('/v1/media/sign-upload', await staff(), '{"filename":" ","contentType":"image/png","sizeBytes":1}');
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('filename: must not be blank');
    const z = await sign('/v1/media/sign-upload', await staff(), '{"filename":"a.png","contentType":"image/png"}');
    expect(z.status).toBe(400);
    expect(z.json.message).toBe('sizeBytes: must be greater than 0');
  });
});

describe('StorageConfiguredUploadIT', () => {
  const api = useServer({
    env: {
      STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      STORAGE_BUCKET: 'ceitba-test',
      STORAGE_ACCESS_KEY_ID: 'AKIDTEST',
      STORAGE_SECRET_ACCESS_KEY: 'secret',
      STORAGE_PUBLIC_URL: 'https://media.test',
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_PROPOSAL_ATTACHMENTS_CAPACITY: '3',
      RATE_LIMIT_PROPOSAL_ATTACHMENTS_PERIOD: '1h',
    },
  });

  test('staffImage_isSigned', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const r = await api.post('/v1/media/sign-upload', { as: await as('boss@itba.edu.ar'), body: '{"filename":"a.png","contentType":"image/png","sizeBytes":1024}' });
    expect(r.status).toBe(200);
    expect(r.json.key).toMatch(/^media\/[0-9a-f-]{36}\.png$/);
    expect(r.json.uploadUrl.startsWith('https://acct.r2.cloudflarestorage.com/ceitba-test/media/')).toBe(true);
    expect(r.json.publicUrl).toBe(`https://media.test/${r.json.key}`);
    expect(r.json.method).toBe('PUT');
    expect(r.json.headers).toEqual({ 'Content-Length': '1024', 'Content-Type': 'image/png' });
    expect(r.json.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3,9})?Z$/);
    expect(Object.keys(r.json)).toEqual(['uploadUrl', 'publicUrl', 'key', 'method', 'headers', 'expiresAt']);
    const q = new URL(r.json.uploadUrl).searchParams;
    expect(q.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(q.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(q.get('X-Amz-Expires')).toBe('600');
  });

  test.skipIf(!hasProposalUpload)('proposalAttachment_isSignedThenRateLimitedPerUser', async () => {
    const body = '{"filename":"doc.pdf","contentType":"application/pdf","sizeBytes":2048}';
    const user = 'quota@itba.edu.ar';
    let first: { text: string; json: { key: string } } | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await api.post('/v1/proposals/attachments/sign-upload', { as: await as(user), body });
      expect(r.status).toBe(200);
      expect(r.json.key).toMatch(/^proposals\/[0-9a-f-]{36}-[0-9a-f]{16}\.pdf$/);
      expect(r.json.headers['Content-Type']).toBe('application/pdf');
      first ??= r;
    }
    // The key is opaque: the response never carries the user id.
    const [{ id }] = await api.db`SELECT id FROM public."user" WHERE email = ${user}` as unknown as [{ id: string }];
    expect(first!.text).not.toContain(id);
    expect(first!.text).not.toContain(id.replaceAll('-', ''));

    const limited = await api.post('/v1/proposals/attachments/sign-upload', { as: await as(user), body });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).not.toBeNull();
    expect(limited.json.error).toBe('TooManyRequests');

    // Another user has their own bucket.
    const other = await api.post('/v1/proposals/attachments/sign-upload', { as: await as('other@itba.edu.ar'), body });
    expect(other.status).toBe(200);
    expect(other.json.key).not.toBe(first!.json.key);
  });

  test.skipIf(!hasProposals)('proposalAcceptsOnlyTheAuthorsSignedKeys', async () => {
    const author = 'attach@itba.edu.ar';
    const sign = async (body: string) => {
      const r = await api.post('/v1/proposals/attachments/sign-upload', { as: await as(author), body });
      expect(r.status).toBe(200);
      return r.json.key as string;
    };
    const png = await sign('{"filename":"a.png","contentType":"image/png","sizeBytes":10}');
    const pdf = await sign('{"filename":"b.pdf","contentType":"application/pdf","sizeBytes":10}');
    const body = `{"title":"Con adjuntos","description":"d","topic":"OTROS","attachmentKeys":["${pdf}","${png}"]}`;

    // Someone else cannot attach the author's uploads.
    expect((await api.post('/v1/proposals', { as: await as('thief@itba.edu.ar'), body })).status).toBe(400);

    const r = await api.post('/v1/proposals', { as: await as(author), body });
    expect(r.status).toBe(201);
    expect(r.json.attachments[0].position).toBe(0);
    expect(r.json.attachments[0].contentType).toBe('application/pdf');
    expect(r.json.attachments[0].url).toBe(`https://media.test/${pdf}`);
    expect(r.json.attachments[1].contentType).toBe('image/png');
    expect(r.json.attachments[1].url).toBe(`https://media.test/${png}`);

    // A key can back only one proposal.
    expect((await api.post('/v1/proposals', { as: await as(author), body })).status).toBe(400);
  });
});
