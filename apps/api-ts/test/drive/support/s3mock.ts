// A tiny S3 endpoint for black-box drive tests (both the Java S3Client and the
// TS @aws-sdk client): path-style PUT/GET/DELETE/HEAD of objects in memory,
// signatures ignored. It plays the role InMemoryObjectStorage plays in
// DriveSyncIT (storage.keys(), storage.putCount()), from outside the server.

export interface S3Mock {
  readonly port: number;
  readonly endpoint: string;
  readonly bucket: string;
  /** STORAGE_* env that points a server at this mock. */
  readonly env: Record<string, string>;
  /** Object keys (without the bucket), sorted. */
  keys(): string[];
  putCount(): number;
  get(key: string): Uint8Array | undefined;
  clear(): void;
  stop(): void;
}

/** Decodes an aws-chunked body (`<hex>;chunk-signature=...\r\n<data>\r\n ... 0;...\r\n\r\n`). */
function dechunk(body: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  const dec = new TextDecoder('latin1');
  while (i < body.length) {
    const eol = body.indexOf(13, i);
    if (eol < 0) break;
    const header = dec.decode(body.subarray(i, eol));
    const size = parseInt(header.split(';')[0]!, 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(body.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function startS3Mock(bucket = 'ceitba-media'): S3Mock {
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      const prefix = `/${bucket}/`;
      if (!path.startsWith(prefix)) return new Response('NoSuchBucket', { status: 404 });
      const key = path.slice(prefix.length);
      if (req.method === 'PUT') {
        let body: Uint8Array = new Uint8Array(await req.arrayBuffer());
        const enc = req.headers.get('content-encoding') ?? '';
        if (enc.includes('aws-chunked') || (req.headers.get('x-amz-content-sha256') ?? '').startsWith('STREAMING-')) body = dechunk(body);
        objects.set(key, body as Uint8Array<ArrayBuffer>);
        puts++;
        return new Response(null, { status: 200, headers: { ETag: '"0123456789abcdef0123456789abcdef"' } });
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const o = objects.get(key);
        if (!o) {
          return new Response('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>',
            { status: 404, headers: { 'Content-Type': 'application/xml' } });
        }
        return new Response(req.method === "HEAD" ? null : (o as Uint8Array<ArrayBuffer>), { status: 200, headers: { 'Content-Length': String(o.length), ETag: '"x"' } });
      }
      return new Response(null, { status: 405 });
    },
  });
  const endpoint = `http://127.0.0.1:${server.port}`;
  return {
    port: server.port!,
    endpoint,
    bucket,
    env: {
      STORAGE_ENDPOINT: endpoint,
      STORAGE_BUCKET: bucket,
      STORAGE_ACCESS_KEY_ID: 'test-access',
      STORAGE_SECRET_ACCESS_KEY: 'test-secret',
      STORAGE_PUBLIC_URL: `${endpoint}/${bucket}`,
      STORAGE_REGION: 'us-east-1',
    },
    keys: () => [...objects.keys()].sort(),
    putCount: () => puts,
    get: (k) => objects.get(k),
    clear: () => { objects.clear(); puts = 0; },
    stop: () => server.stop(true),
  };
}
