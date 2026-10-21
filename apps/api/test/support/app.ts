// In-process app for tests that cannot be black-box (they inject fakes, a
// clock, a stubbed Google, or hold a transaction open): a real Postgres clone
// of the contract template + createApp(deps) + app.request(). Uses the same
// Postgres as the contract suite (CONTRACT_PG_URL, or a Testcontainers one).

import type { Sql } from 'postgres';
import { CONTRACT_ENV } from '../../contract/support/env';
import { cloneDatabase, connect, dropDatabase, jdbcParts, pgServerUrl, withDatabase } from '../../contract/support/pg';
import { loadConfig } from '../../src/config';
import { buildDeps, type Deps, type DepsOverrides } from '../../src/deps';
import { createApp, type App } from '../../src/http/app';
import { silentLogger } from '../../src/infra/logger';

export interface TestApp {
  app: App;
  deps: Deps;
  /** Raw SQL on the app's database (seeding/asserting, like JdbcTemplate). */
  sql: Sql;
  request(method: string, path: string, opts?: { body?: unknown; headers?: Record<string, string>; remoteAddr?: string }): Promise<{ status: number; headers: Headers; json: any; text: string; setCookies: string[] }>;
  close(): Promise<void>;
}

export async function testApp(opts: { env?: Record<string, string>; overrides?: DepsOverrides } = {}): Promise<TestApp> {
  const dbName = await cloneDatabase('it');
  const url = withDatabase(await pgServerUrl(), dbName);
  const { jdbc, user, password } = jdbcParts(url);
  const config = await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password, ...opts.env });
  const deps = await buildDeps(config, { log: silentLogger, ...opts.overrides });
  const app = await createApp(deps);
  const sql = connect(url);
  return {
    app, deps, sql,
    async request(method, path, o = {}) {
      const headers = new Headers(o.headers ?? {});
      let body: string | undefined;
      if (o.body !== undefined) {
        body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      }
      const res = await app.request(`http://localhost/api${path}`, { method, headers, body }, o.remoteAddr);
      const text = await res.text();
      let json: unknown;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
      return { status: res.status, headers: res.headers, json, text, setCookies: res.headers.getSetCookie() };
    },
    async close() {
      await sql.end({ timeout: 2 });
      await deps.close();
      await dropDatabase(dbName);
    },
  };
}
