// startServer(): a fresh server process (Bun, or a Java jar) on a free port,
// against a fresh clone of the migrated template database. One per test file
// (beforeAll), so no in-memory state (rate-limit buckets, caches) leaks.
//
//   CONTRACT_TARGET=java|ts   (default ts)
//   CONTRACT_JAR              the Spring Boot jar for the java target. The Java app was deleted after the
//                             cutover; build one from the last Java commit to compare or to rehearse a rollback.
//   CONTRACT_JAVA_HOME        default ~/.local/jdk/jdk-21.0.12.1+1/Contents/Home, else JAVA_HOME
//   CONTRACT_KEEP_LOGS=1      print the server log when a file finishes

import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from 'postgres';
import { cloneDatabase, connect, dropDatabase, jdbcParts, pgServerUrl, withDatabase } from './pg';
import { CONTRACT_ENV } from './env';
import { recordHit, runDir } from './hits';

export type Target = 'java' | 'ts';
export const TARGET: Target = (process.env.CONTRACT_TARGET as Target) === 'java' ? 'java' : 'ts';

const API_DIR = join(import.meta.dir, '..', '..');
const REPO_DIR = join(API_DIR, '..', '..');
const JAR = process.env.CONTRACT_JAR ?? '';
/** True when CONTRACT_JAR names an existing jar: tests that need the Java app (cross-runtime) run only then. */
export const JAVA_AVAILABLE = JAR !== '' && existsSync(JAR);
export const JAVA_TARGET_REMOVED = 'The Java app was deleted after the cutover to Bun: the java target needs CONTRACT_JAR=<a jar built from the last Java commit> (git worktree add <dir> <sha>; cd <dir>/apps/api && ./mvnw -B -ntp -q package -DskipTests).';
const LOG_DIR = runDir(join(API_DIR, 'contract', '.logs'));
/** CONTRACT_RECORD=1 appends every request to contract/.corpus/corpus.jsonl (replayed by contract/diff.ts). */
const CORPUS_DIR = join(API_DIR, 'contract', '.corpus');

function javaBin(): string {
  const home = process.env.CONTRACT_JAVA_HOME
    ?? (existsSync(join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home')) ? join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home') : process.env.JAVA_HOME);
  return home ? join(home, 'bin', 'java') : 'java';
}

// A port the OS just handed out and released. Another worker can grab it before
// the server binds it, so startServer retries the spawn when the bind fails.
async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response() });
  const p = s.port!;
  s.stop(true);
  return p;
}

const PORT_IN_USE = /address already in use|EADDRINUSE|Port \d+ (?:was|is) already in use|Failed to start bean 'webServerStartStop'/i;
/** Readiness probe timeout: a hung probe (a JVM under memory pressure) must not block the run. */
const PROBE_TIMEOUT_MS = 2_000;
const READY_DEADLINE_MS = 120_000;

/** Waits until no other session of this database runs a statement or holds an open transaction. */
export async function quiesce(db: Sql, timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [r] = await db`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
        AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')`;
    if (r!.n === 0 || Date.now() > until) return;
    await Bun.sleep(20);
  }
}

/**
 * The test's postgres.js client: a cleanup statement (TRUNCATE / DELETE) first
 * waits for the server to be idle (quiesce). Otherwise it can deadlock with
 * the server's after-commit background work (a push delivery still writing
 * push_log while TRUNCATE takes its ACCESS EXCLUSIVE lock).
 */
function cleanupAware(db: Sql): Sql {
  return new Proxy(db, {
    apply(target, thisArg, args: unknown[]) {
      const strings = args[0] as TemplateStringsArray | undefined;
      if (Array.isArray(strings) && 'raw' in strings && /^\s*(TRUNCATE|DELETE)\b/i.test(strings[0] ?? '')) {
        return (async () => {
          await quiesce(target);
          return await (Reflect.apply(target, thisArg, args) as Promise<unknown>);
        })();
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
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
  /**
   * Run on another server's database instead of a fresh clone (the blue/green
   * overlap: Java and Bun on one database). Read when the server starts, so it
   * can name a server started earlier in the same file. The owner drops it.
   */
  shareDatabaseWith?: () => Server;
}

export async function startServer(opts: StartOptions = {}): Promise<Server> {
  const target = opts.target ?? TARGET;
  const server = await pgServerUrl();
  const shared = opts.shareDatabaseWith?.();
  const dbName = shared ? shared.dbName : await cloneDatabase(target === 'java' ? 'cj' : 'ct');
  const dbUrl = withDatabase(server, dbName);
  const { jdbc, user, password } = jdbcParts(dbUrl);
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${target}-${dbName}.log`);
  const t0 = performance.now();
  let env!: Record<string, string>;
  let proc!: ReturnType<typeof Bun.spawn>;
  let url = '';
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    env = { ...CONTRACT_ENV, PORT: String(port), DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password };
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      if (v === null) delete env[k];
      else env[k] = v;
    }
    const out = openSync(logFile, 'w');
    const spawnEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env };
    if (target === 'java') {
      if (!JAVA_AVAILABLE) throw new Error(JAR ? `${JAR} is missing. ${JAVA_TARGET_REMOVED}` : JAVA_TARGET_REMOVED);
      // en_US like the eclipse-temurin image (Bean Validation messages without Accept-Language).
      proc = Bun.spawn([javaBin(), '-XX:TieredStopAtLevel=1', '-Xss512k', '-Duser.language=en', '-Duser.country=US', '-jar', JAR], { env: spawnEnv, stdout: out, stderr: out, cwd: REPO_DIR });
    } else {
      proc = Bun.spawn([process.execPath, 'src/main.ts'], { env: spawnEnv, stdout: out, stderr: out, cwd: API_DIR });
    }
    url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + READY_DEADLINE_MS;
    let ready = false;
    for (;;) {
      if (proc.exitCode !== null) break;
      try {
        const r = await fetch(`${url}/api/actuator/health/readiness`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (r.status === 200) { ready = true; break; }
      } catch {
        // not up yet, or the probe timed out
      }
      if (Date.now() > deadline) {
        proc.kill('SIGKILL');
        throw new Error(`${target} server did not become ready in ${READY_DEADLINE_MS / 1000}s:\n${readFileSync(logFile, 'utf8').slice(-4000)}`);
      }
      await Bun.sleep(target === 'java' ? 150 : 40);
    }
    if (ready) break;
    const log = readFileSync(logFile, 'utf8');
    if (attempt < 4 && PORT_IN_USE.test(log)) continue; // another worker took the port first
    throw new Error(`${target} server exited (${proc.exitCode}):\n${log.slice(-4000)}`);
  }
  const bootMs = Math.round(performance.now() - t0);
  appendFileSync(join(LOG_DIR, `boot-${target}.jsonl`), `${JSON.stringify({ bootMs, at: Date.now() })}\n`);
  const db = cleanupAware(connect(dbUrl));

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
      if (!shared) await dropDatabase(dbName).catch(() => {});
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
