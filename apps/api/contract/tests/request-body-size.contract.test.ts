// Intentional hardening vs the Java app (contract/COMPATIBILITY.md "Request body size"): a request body is capped
// at 1 MiB unless the route takes bulk payloads (SYNC Firestore import, STAFF wiki import: 64 MiB; authored content
// such as articles: 10 MiB). Larger -> 413 PayloadTooLarge with the usual error body, whether the size is declared
// (Content-Length) or only found while reading a chunked body. Spring had no cap on JSON bodies. TS-only.
// Bun.serve's own ceiling sits a few MiB above the largest cap (SERVER_MAX_BODY_BYTES), so every body over a
// route's cap still gets the JSON 413; only a declared length over that ceiling gets Bun's empty 413.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, TARGET, useServer } from '../support';

const api = useServer();
const MIB = 1024 * 1024;
const padded = (bytes: number) => JSON.stringify({ type: 'up', pad: 'x'.repeat(bytes) });
const BULK_CAP = 64 * MIB;

/** Sends only the request head (and a few body bytes) over a raw socket; resolves with the status line and body. */
async function headOnly(url: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  let raw = '';
  return new Promise((resolve, reject) => {
    const done = () => {
      const [head, ...rest] = raw.split('\r\n\r\n');
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head ?? '')?.[1] ?? 0);
      const chunked = /transfer-encoding: chunked/i.test(head ?? '');
      let body = rest.join('\r\n\r\n');
      if (chunked) body = body.replace(/^[0-9a-f]+\r\n/i, '').replace(/\r\n0\r\n\r\n$/, '');
      resolve({ status, body });
    };
    Bun.connect({
      hostname: hostname === 'localhost' ? '127.0.0.1' : hostname, port: Number(port),
      socket: {
        open(sock) {
          const lines = [`POST /api${path} HTTP/1.1`, `Host: ${hostname}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
          sock.write(`${lines.join('\r\n')}\r\n\r\n{"pages":[`);
          setTimeout(() => { sock.end(); done(); }, 1500);
        },
        data(_sock, chunk) { raw += new TextDecoder().decode(chunk); },
        close() { done(); },
        error(_sock, e) { reject(e); },
      },
    }).catch(reject);
  });
}

async function staffBearer(): Promise<string> {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  return `Bearer ${await mintJwt({ email: 'boss@itba.edu.ar' })}`;
}

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

  test('aDeclaredBodyJustOverTheBulkCapGetsTheJson413', async () => {
    const r = await headOnly(api.url, '/v1/staff/kb/subjects/NOPE/import', {
      Authorization: await staffBearer(), 'Content-Type': 'application/json', 'Content-Length': String(BULK_CAP + MIB),
    });
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body).error).toBe('PayloadTooLarge');
  });

  test('aChunkedBodyOverTheBulkCapGetsTheJson413', async () => {
    const as = await staffBearer();
    const chunk = new Uint8Array(MIB).fill(0x78);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) { ctl.enqueue(new TextEncoder().encode('{"pages":[],"pad":"')); },
      pull(ctl) {
        if (sent++ < 66) ctl.enqueue(chunk);
        else { ctl.enqueue(new TextEncoder().encode('"}')); ctl.close(); }
      },
    });
    const res = await fetch(`${api.url}/api/v1/staff/kb/subjects/NOPE/import`, {
      method: 'POST', headers: { Authorization: as, 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('PayloadTooLarge');
  });

  test('aDeclaredBodyOverTheServerCeilingGetsBunsEmpty413', async () => {
    const r = await headOnly(api.url, '/v1/staff/kb/subjects/NOPE/import', {
      Authorization: await staffBearer(), 'Content-Type': 'application/json', 'Content-Length': String(BULK_CAP + 8 * MIB),
    });
    expect(r.status).toBe(413);
    expect(r.body).toBe('');
  });
});
