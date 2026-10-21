// Intentional hardening vs the Java app (contract/COMPATIBILITY.md "Request body size"): a request body is capped
// at 1 MiB unless the route takes bulk payloads (SYNC Firestore import, STAFF wiki import: 64 MiB; authored content
// such as articles: 10 MiB). Larger -> 413 PayloadTooLarge with the usual error body, whether the size is declared
// (Content-Length) or only found while reading a chunked body. Spring had no cap on JSON bodies. TS-only.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, TARGET, useServer } from '../support';

const api = useServer();
const MIB = 1024 * 1024;
const padded = (bytes: number) => JSON.stringify({ type: 'up', pad: 'x'.repeat(bytes) });

describe.skipIf(TARGET === 'java')('RequestBodySize (TS hardening)', () => {
  test('aBodyOverTheDefaultCapIs413', async () => {
    const r = await api.post('/v1/articles/nope/votes', { body: padded(MIB + 10) });
    expect(r.status).toBe(413);
    expect(r.json.error).toBe('PayloadTooLarge');
    expect(r.json.message).toBe('Maximum upload size exceeded');
    expect(r.json.path).toBe('/api/v1/articles/nope/votes');
  });

  test('aBodyUnderTheCapIsRead', async () => {
    expect((await api.post('/v1/articles/nope/votes', { body: padded(MIB - 100) })).status).toBe(404);
  });

  test('aChunkedBodyOverTheCapIs413', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(256 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) { ctl.enqueue(new TextEncoder().encode('{"type":"up","pad":"')); },
      pull(ctl) {
        if (sent++ < 6) ctl.enqueue(chunk);
        else { ctl.enqueue(new TextEncoder().encode('"}')); ctl.close(); }
      },
    });
    const res = await fetch(`${api.url}/api/v1/articles/nope/votes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('PayloadTooLarge');
  });

  test('aBulkRouteTakesMoreThanTheDefault', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const as = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
    const body = JSON.stringify({ pages: [], replace: false, pad: 'x'.repeat(2 * MIB) });
    expect((await api.post('/v1/staff/kb/subjects/NOPE/import', { as, body })).status).not.toBe(413);
  });
});
