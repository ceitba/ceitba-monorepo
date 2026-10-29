// Diff runner: replays one request list against a Java and a TS server, each
// on its own clone of the same database, and diffs status, key headers and
// the JSON body (volatile values normalized: timestamps, UUIDs, tokens, keys).
//
//   CONTRACT_RECORD=1 bun contract/run.ts --target ts   # records contract/.corpus/corpus.jsonl
//   bun contract/diff.ts                                # replays it (or the built-in corpus)
//   bun contract/diff.ts --corpus my.jsonl --seed seed.sql --env REVIEW_LOGIN_EMAIL=a@b.c
//
// A corpus line: {"method":"GET","path":"/api/v1/careers","headers":{...},"body":null}.
// Requests are replayed in order on both servers, so stateful sequences stay comparable.
// Tokens in recorded headers were minted with the test secret and stay valid for an hour.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mintJwt } from './support/identity';
import { startServer, type Server } from './support/server';

interface Req { method: string; path: string; headers?: Record<string, string>; body?: string | null }

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const corpusFile = opt('--corpus') ?? join(import.meta.dir, '.corpus', 'corpus.jsonl');
const seedFile = opt('--seed');
const env: Record<string, string> = {};
args.forEach((a, i) => { if (a === '--env') { const [k, ...v] = args[i + 1]!.split('='); env[k!] = v.join('='); } });

async function builtInCorpus(): Promise<Req[]> {
  const user = `Bearer ${await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' })}`;
  return [
    { method: 'GET', path: '/api/v1/careers' },
    { method: 'GET', path: '/api/v1/careers/plans' },
    { method: 'GET', path: '/api/v1/careers/NOPE' },
    { method: 'GET', path: '/api/v1/auth/me' },
    { method: 'GET', path: '/api/v1/auth/me', headers: { Authorization: user } },
    { method: 'GET', path: '/api/v1/auth/api-keys', headers: { Authorization: user } },
    { method: 'POST', path: '/api/v1/careers', headers: { Authorization: user, 'Content-Type': 'application/json' }, body: '{"id":"Z","name":"z"}' },
    { method: 'PATCH', path: '/api/v1/careers/S', headers: { Authorization: user } },
    { method: 'GET', path: '/api/v1/nope', headers: { Authorization: user } },
    { method: 'POST', path: '/api/v1/auth/logout' },
    { method: 'GET', path: '/api/actuator/health' },
    { method: 'GET', path: '/api/actuator/health/readiness' },
  ];
}

const corpus: Req[] = existsSync(corpusFile)
  ? readFileSync(corpusFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Req)
  : await builtInCorpus();

const VOLATILE = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, '<ts>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>'],
  [/ceitba_[A-Za-z0-9_-]{43}/g, '<apikey>'],
  [/[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{43}/g, '<state>'],
  [/\b[A-Za-z0-9_-]{43}\b/g, '<token>'],
  [/(ceitba_oauth_state=)[A-Za-z0-9_-]+/g, '$1<nonce>'],
  [/Expires=[^;]+/g, 'Expires=<date>'],
  [/"uptime":[0-9.]+/g, '"uptime":<n>'],
  [/"(total|free|used|max)":\d+/g, '"$1":<n>'],
  [/localhost:\d+/g, 'localhost:<port>'],
  [/127\.0\.0\.1:\d+/g, 'localhost:<port>'],
  // DataSyncResult.duration: elapsed milliseconds.
  [/"duration":\d+/g, '"duration":<ms>'],
  // Proposal pseudonyms: ProposalAliasGenerator picks a free one with SecureRandom.
  [/"(authorAlias|alias)":"[^"]+"/g, '"$1":"<alias>"'],
] as const;

const norm = (s: string) => VOLATILE.reduce((acc, [re, rep]) => acc.replace(re, rep as string), s);

/**
 * What is compared of a body. Not stable in Java, so canonicalized here:
 *   - Map.of bodies (HealthController): keys sorted;
 *   - several Bean Validation violations: Java takes them from a HashSet (docs/SERIALIZATION.md), sorted;
 *   - /api/docs.json: springdoc's document vs the one the TS app generates (no component schemas, other
 *     operationIds; nothing consumes it): only the documented operations ("METHOD /path") are compared.
 */
function canonicalBody(path: string, text: string): string {
  if (!text) return '';
  let v: unknown;
  try { v = JSON.parse(text); } catch { return norm(text); }
  if (/^\/api\/docs\.json$/.test(path.split('?')[0]!) && v && typeof v === 'object' && 'paths' in v) {
    const paths = (v as { paths: Record<string, Record<string, unknown>> }).paths;
    return JSON.stringify(Object.entries(paths).flatMap(([p, m]) => Object.keys(m).map((k) => `${k.toUpperCase()} ${p}`)).sort());
  }
  const e = v as { error?: unknown; message?: unknown };
  if (e && e.error === 'ValidationError' && typeof e.message === 'string' && e.message.includes('; ')) {
    e.message = e.message.split('; ').sort().join('; ');
  }
  const unordered = /^\/api\/?$|^\/api\/health$/.test(path);
  const sortKeys = (x: unknown): unknown => Array.isArray(x) ? x.map(sortKeys)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])])) : x;
  return norm(JSON.stringify(unordered ? sortKeys(v) : v));
}

const HEADERS = ['content-type', 'location', 'www-authenticate', 'cache-control', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'access-control-allow-origin'];

async function send(s: Server, r: Req) {
  const res = await fetch(s.url + r.path, { method: r.method, headers: r.headers, body: r.body ?? undefined, redirect: 'manual' });
  const text = await res.text();
  const headers: Record<string, string> = {};
  for (const h of HEADERS) { const v = res.headers.get(h); if (v !== null) headers[h] = norm(v); }
  const allow = res.headers.get('allow');
  if (allow) headers.allow = allow.split(/,\s*/).sort().join(',');
  const cookies = res.headers.getSetCookie().map(norm).sort();
  return { status: res.status, headers, cookies, body: canonicalBody(r.path, text) };
}

const [java, ts] = await Promise.all([startServer({ target: 'java', env }), startServer({ target: 'ts', env })]);
try {
  if (seedFile) {
    const sql = readFileSync(seedFile, 'utf8');
    await java.db.unsafe(sql).simple();
    await ts.db.unsafe(sql).simple();
  }
  let diffs = 0;
  for (const r of corpus) {
    const [a, b] = [await send(java, r), await send(ts, r)];
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) {
      diffs++;
      console.log(`DIFF ${r.method} ${r.path}`);
      for (const k of ['status', 'headers', 'cookies', 'body'] as const) {
        const x = JSON.stringify(a[k]);
        const y = JSON.stringify(b[k]);
        if (x !== y) console.log(`  ${k}\n    java: ${x}\n    ts:   ${y}`);
      }
    }
  }
  console.log(`${corpus.length} requests replayed, ${diffs} differ`);
  process.exitCode = diffs ? 1 : 0;
} finally {
  await Promise.all([java.stop(), ts.stop()]);
}
