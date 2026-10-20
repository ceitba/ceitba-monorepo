// startServer(): a fresh server process (Java jar or Bun) on a free port,
// against a fresh clone of the migrated template database. One per test file
// (beforeAll), so no in-memory state (rate-limit buckets, caches) leaks.
//
//   CONTRACT_TARGET=java|ts   (default ts)
//   CONTRACT_JAVA_HOME        default ~/.local/jdk/jdk-21.0.12.1+1/Contents/Home, else JAVA_HOME
//   CONTRACT_JAR              default apps/api/target/ceitba-api-1.0.0.jar
//   CONTRACT_KEEP_LOGS=1      print the server log when a file finishes

import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from 'postgres';
import { cloneDatabase, connect, dropDatabase, jdbcParts, pgServerUrl, withDatabase } from './pg';
import { CONTRACT_ENV } from './env';
import { recordHit } from './hits';

export type Target = 'java' | 'ts';
export const TARGET: Target = (process.env.CONTRACT_TARGET as Target) === 'java' ? 'java' : 'ts';

const API_TS_DIR = join(import.meta.dir, '..', '..');
const REPO_DIR = join(API_TS_DIR, '..', '..');
const JAR = process.env.CONTRACT_JAR ?? join(REPO_DIR, 'apps', 'api', 'target', 'ceitba-api-1.0.0.jar');
const LOG_DIR = join(API_TS_DIR, 'contract', '.logs');
/** CONTRACT_RECORD=1 appends every request to contract/.corpus/corpus.jsonl (replayed by contract/diff.ts). */
const CORPUS_DIR = join(API_TS_DIR, 'contract', '.corpus');

function javaBin(): string {
  const home = process.env.CONTRACT_JAVA_HOME
    ?? (existsSync(join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home')) ? join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home') : process.env.JAVA_HOME);
  return home ? join(home, 'bin', 'java') : 'java';
}

async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response() });
  const p = s.port!;
  s.stop(true);
  return p;
}

/** How a request authenticates. */
export type As =
  | { bearer: string }
  | { cookie: string }
  | { apiKey: string }
  | { headers: Record<string, string> };

export const bearer = (token: string): As => ({ bearer: token });
export const sessionCookie = (token: string): As => ({ cookie: token });
export const apiKey = (key: string): As => ({ apiKey: key });

export interface RequestOptions {
  as?: As;
  /** JSON-serialized unless a string (sent as is). */
  body?: unknown;
  /** Default application/json when a body is given. */
  contentType?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Raw path (no /api prefix added, no encoding): for encoded-path tests. */
  rawPath?: boolean;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  text: string;
  /** Parsed JSON body (undefined when the body is empty or not JSON). */
  json: any;
  /** All Set-Cookie headers. */
  setCookies: string[];
  /** Location header. */
  location: string | null;
}

export interface Server {
  target: Target;
  url: string;
  /** postgres.js client to this server's own database. */
  db: Sql;
  dbName: string;
  env: Record<string, string>;
  request(method: string, path: string, opts?: RequestOptions): Promise<ApiResponse>;
  get(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  post(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  put(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  patch(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  delete(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  head(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  options(path: string, opts?: RequestOptions): Promise<ApiResponse>;
  /** Milliseconds from spawn to the first healthy answer. */
  bootMs: number;
  stop(): Promise<void>;
}

export interface StartOptions {
  /** Extra/overriding env (e.g. review login, AUTH_ALLOWED_EMAILS). Use `null` to unset a default. */
  env?: Record<string, string | null>;
  target?: Target;
}

export async function startServer(opts: StartOptions = {}): Promise<Server> {
  const target = opts.target ?? TARGET;
  const server = await pgServerUrl();
  const dbName = await cloneDatabase(target === 'java' ? 'cj' : 'ct');
  const dbUrl = withDatabase(server, dbName);
  const { jdbc, user, password } = jdbcParts(dbUrl);
  const port = await freePort();
  const env: Record<string, string> = { ...CONTRACT_ENV, PORT: String(port), DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password };
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${target}-${dbName}.log`);
  const out = openSync(logFile, 'w');
  const spawnEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env };
  const t0 = performance.now();
  let proc;
  if (target === 'java') {
    if (!existsSync(JAR)) throw new Error(`${JAR} is missing: build it with cd apps/api && ./mvnw -B -ntp -q -o package -DskipTests`);
    // en_US like the eclipse-temurin image (Bean Validation messages without Accept-Language).
    proc = Bun.spawn([javaBin(), '-XX:TieredStopAtLevel=1', '-Xss512k', '-Duser.language=en', '-Duser.country=US', '-jar', JAR], { env: spawnEnv, stdout: out, stderr: out, cwd: REPO_DIR });
  } else {
    proc = Bun.spawn([process.execPath, 'src/main.ts'], { env: spawnEnv, stdout: out, stderr: out, cwd: API_TS_DIR });
  }
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`${target} server exited (${proc.exitCode}):\n${readFileSync(logFile, 'utf8').slice(-4000)}`);
    try {
      const r = await fetch(`${url}/api/actuator/health/readiness`);
      if (r.status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(`${target} server did not become ready:\n${readFileSync(logFile, 'utf8').slice(-4000)}`);
    }
    await Bun.sleep(target === 'java' ? 150 : 40);
  }
  const bootMs = Math.round(performance.now() - t0);
  appendFileSync(join(LOG_DIR, `boot-${target}.jsonl`), `${JSON.stringify({ bootMs, at: Date.now() })}\n`);
  const db = connect(dbUrl);

  const request = async (method: string, path: string, o: RequestOptions = {}): Promise<ApiResponse> => {
    const headers = new Headers(o.headers ?? {});
    const a = o.as;
    if (a) {
      if ('bearer' in a) headers.set('Authorization', `Bearer ${a.bearer}`);
      else if ('cookie' in a) headers.append('Cookie', `${env.AUTH_COOKIE_NAME ?? 'ceitba_session'}=${a.cookie}`);
      else if ('apiKey' in a) headers.set('X-Api-Key', a.apiKey);
      else for (const [k, v] of Object.entries(a.headers)) headers.set(k, v);
    }
    let body: string | undefined;
    if (o.body !== undefined) {
      body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
      if (o.contentType !== null && !headers.has('Content-Type')) headers.set('Content-Type', o.contentType ?? 'application/json');
    } else if (o.contentType) {
      headers.set('Content-Type', o.contentType);
    }
    let full = o.rawPath ? path : `/api${path}`;
    if (o.query) {
      const qs = Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
      if (qs) full += (full.includes('?') ? '&' : '?') + qs;
    }
    if (process.env.CONTRACT_RECORD) {
      mkdirSync(CORPUS_DIR, { recursive: true });
      appendFileSync(join(CORPUS_DIR, 'corpus.jsonl'), `${JSON.stringify({ method, path: full, headers: Object.fromEntries(headers), body: body ?? null })}\n`);
    }
    const res = await fetch(url + full, { method, headers, body, redirect: 'manual' });
    const text = await res.text();
    let json: unknown;
    try {
      json = text.length ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    recordHit(target, method, full.replace(/^\/api/, ''), res.status);
    return { status: res.status, headers: res.headers, text, json, setCookies: res.headers.getSetCookie(), location: res.headers.get('Location') };
  };

  return {
    target, url, db, dbName, env, bootMs, request,
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    put: (p, o) => request('PUT', p, o),
    patch: (p, o) => request('PATCH', p, o),
    delete: (p, o) => request('DELETE', p, o),
    head: (p, o) => request('HEAD', p, o),
    options: (p, o) => request('OPTIONS', p, o),
    async stop() {
      proc.kill('SIGTERM');
      await Promise.race([proc.exited, Bun.sleep(10_000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
      await db.end({ timeout: 2 }).catch(() => {});
      await dropDatabase(dbName).catch(() => {});
      if (process.env.CONTRACT_KEEP_LOGS) console.log(readFileSync(logFile, 'utf8'));
      else rmSync(logFile, { force: true });
    },
  };
}

/** Server boot can take a while (JVM): hook timeout for beforeAll/afterAll. */
export const BOOT_TIMEOUT_MS = 180_000;

/**
 * Registers beforeAll/afterAll that start a server for this test file and
 * returns a handle usable inside tests (`api.get(...)`, `api.db`...).
 *   const api = useServer({ env: { REVIEW_LOGIN_EMAIL: '...' } });
 */
export function useServer(opts: StartOptions & { setup?: (s: Server) => Promise<void> } = {}): Server {
  let current: Server | undefined;
  const { beforeAll, afterAll } = require('bun:test') as typeof import('bun:test');
  beforeAll(async () => {
    current = await startServer(opts);
    if (opts.setup) await opts.setup(current);
  }, BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await current?.stop();
  }, BOOT_TIMEOUT_MS);
  return new Proxy({} as Server, {
    get(_t, k) {
      if (!current) throw new Error('useServer(): the server is not started yet (use it inside tests/hooks)');
      const v = (current as unknown as Record<PropertyKey, unknown>)[k];
      // `db` is a callable postgres.js client: hand it over untouched.
      return typeof v === 'function' && k !== 'db' ? (v as (...a: unknown[]) => unknown).bind(current) : v;
    },
  });
}
