// external/drive/GoogleDriveClient against a local Drive v3 mock: the requests it
// builds (spike 2: same path/query as Java's client), RFC 3339/size parsing, and
// the hand-ported retry policy (429, 403 rate limits, 5xx: 4 attempts with 1s/2s/4s
// back-off; everything else at once) and DriveApiException translation.
import { afterAll, describe, expect, test } from 'bun:test';
import { decodeKey, escapeQ, GoogleDriveClient } from '../../src/external/drive/google';
import { DriveApiError } from '../../src/external/drive';

const KEY = JSON.stringify({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: 'unused', token_uri: 'http://x' });
const hits: string[] = [];
let script: Response[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    hits.push(`${req.method} ${u.pathname}?${[...u.searchParams].sort().map(([k, v]) => `${k}=${v}`).join('&')} ${req.headers.get('authorization')}`);
    const next = script.shift();
    return next ?? new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  },
});
afterAll(() => server.stop(true));
const err = (status: number, reason: string | null, message = 'boom') => new Response(JSON.stringify({
  error: { code: status, message, errors: reason ? [{ reason, message, domain: 'global' }] : [] },
}), { status, headers: { 'Content-Type': 'application/json' } });
const jsonRes = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
const sleeps: number[] = [];
const client = () => new GoogleDriveClient(KEY, { rootUrl: `http://127.0.0.1:${server.port}/`, accessToken: async () => 'tok', sleep: async (ms) => { sleeps.push(ms); } });

describe('GoogleDriveClient', () => {
  test('key decoding, bot email, q escaping', () => {
    expect(new GoogleDriveClient(Buffer.from(KEY).toString('base64')).botEmail()).toBe('bot@proj.iam.gserviceaccount.com');
    expect(decodeKey(`  ${KEY}\n`)).toBe(KEY);
    expect(escapeQ("fold'er\\x")).toBe("fold\\'er\\\\x");
    expect(() => new GoogleDriveClient('not base64 json')).toThrow(/Invalid DRIVE_SYNC_SERVICE_ACCOUNT_JSON/);
  });

  test('listChildren pages through files.list with the Java fields and parses items', async () => {
    hits.length = 0;
    script = [
      jsonRes({ nextPageToken: 'p2', files: [{ id: 'a', name: 'Ñandú.pdf', mimeType: 'application/pdf', parents: ['F'], owners: [{ emailAddress: 'x@itba.edu.ar' }],
        modifiedTime: '2024-03-01T10:00:00.123Z', createdTime: '2024-02-01T10:00:00Z', md5Checksum: 'abc', version: '7', size: '1234' }] }),
      jsonRes({ files: [{ id: 's', name: 'atajo', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't', targetMimeType: 'application/pdf' } }] }),
    ];
    const items = await client().listChildren("fold'er");
    expect(items.map((i) => i.id)).toEqual(['a', 's']);
    expect(items[0]).toEqual({ id: 'a', name: 'Ñandú.pdf', mimeType: 'application/pdf', parents: ['F'], ownerEmails: ['x@itba.edu.ar'],
      modifiedTime: Date.parse('2024-03-01T10:00:00.123Z') * 1000, md5Checksum: 'abc', version: 7, size: 1234,
      shortcutTargetId: null, shortcutTargetMimeType: null, createdTime: Date.parse('2024-02-01T10:00:00Z') * 1000 });
    expect(items[1]!.shortcutTargetId).toBe('t');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toContain("q='fold\\'er' in parents and trashed=false");
    expect(hits[0]).toContain('fields=nextPageToken,files(id,name,mimeType,parents,owners(emailAddress),createdTime,modifiedTime,md5Checksum,version,size,shortcutDetails(targetId,targetMimeType))');
    expect(hits[0]).toContain('includeItemsFromAllDrives=true');
    expect(hits[0]).toContain('pageSize=1000');
    expect(hits[0]).toContain('supportsAllDrives=true');
    expect(hits[0]).toContain('Bearer tok');
    expect(hits[1]).toContain('pageToken=p2');
  });

  test('rate limits and 5xx are retried 4 times with back-off; other errors are not', async () => {
    sleeps.length = 0;
    hits.length = 0;
    script = [err(429, 'rateLimitExceeded'), err(403, 'userRateLimitExceeded'), err(503, null), jsonRes({ id: 'f', name: 'n', mimeType: 'm' })];
    expect((await client().getFile('f')).id).toBe('f');
    expect(hits).toHaveLength(4);
    expect(sleeps.map((s) => Math.floor(s / 1000))).toEqual([1, 2, 4]);
    expect(sleeps.every((s, i) => s - 1000 * 2 ** i < 250)).toBe(true);

    script = [err(429, 'rateLimitExceeded'), err(429, 'rateLimitExceeded'), err(429, 'rateLimitExceeded'), err(429, 'rateLimitExceeded')];
    const e = await client().getFile('f').then(() => null, (x: unknown) => x as DriveApiError);
    expect(e).toBeInstanceOf(DriveApiError);
    expect([e!.status, e!.reason, e!.isRateLimited()]).toEqual([429, 'rateLimitExceeded', true]);

    hits.length = 0;
    script = [err(404, 'notFound', 'File not found: f.')];
    const nf = await client().getFile('f').then(() => null, (x: unknown) => x as DriveApiError);
    expect([nf!.status, nf!.reason, nf!.message, nf!.isNotFoundOrForbidden()]).toEqual([404, 'notFound', 'File not found: f.', true]);
    expect(hits).toHaveLength(1);
  });

  test('media: download/export stream the bytes; a blocked export is reported with its reason', async () => {
    hits.length = 0;
    script = [new Response('%PDF-1.4 bytes'), err(403, 'cannotExportFile', 'This file cannot be exported by the user.')];
    const body = await new Response(await client().download('id1')).text();
    expect(body).toBe('%PDF-1.4 bytes');
    expect(hits[0]).toStartWith('GET /drive/v3/files/id1?alt=media&supportsAllDrives=true');
    const blocked = await client().export('id2', 'application/pdf').then(() => null, (x: unknown) => x as DriveApiError);
    expect([blocked!.status, blocked!.isDownloadBlocked(), blocked!.isNotFoundOrForbidden()]).toEqual([403, true, false]);
    expect(hits[1]).toStartWith('GET /drive/v3/files/id2/export?mimeType=application/pdf');
  });

  test('I/O errors are status 0 "io", transient', async () => {
    const dead = new GoogleDriveClient(KEY, { rootUrl: 'http://127.0.0.1:1/', accessToken: async () => 'tok', sleep: async () => {} });
    const e = await dead.download('x').then(() => null, (x: unknown) => x as DriveApiError);
    expect([e!.status, e!.reason, e!.isTransient()]).toEqual([0, 'io', true]);
  });
});
