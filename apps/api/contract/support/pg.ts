// One Postgres for the whole contract run, a TEMPLATE database migrated like
// the Java ITs (apps/api/src/test/resources/application.yml:
// locations db/migration + db/test-migration, up to IT_FLYWAY_TARGET) with our
// Flyway-compatible runner, and a fresh clone of it per test file.
//
//   CONTRACT_PG_URL=postgres://user:pass@host:port/postgres   reuse a server
//   (unset)                                                    start pgvector in Docker (Testcontainers)
//
// contract/run.ts starts the server once and passes CONTRACT_PG_URL and
// CONTRACT_TEMPLATE_DB to its workers.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../../src/config/sections/db';
import { migrate } from '../../src/db/migrate';

export const PG_IMAGE = 'pgvector/pgvector:0.8.6-pg16-bookworm';
/** spring.flyway.target in apps/api/src/test/resources/application.yml. */
export const IT_FLYWAY_TARGET = '4.56';
export const IT_LOCATIONS = [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR];

let serverUrl: Promise<string> | undefined;

/** postgres://... of the maintenance database (`postgres`) of the shared server. */
export function pgServerUrl(): Promise<string> {
  serverUrl ??= (async () => {
    if (process.env.CONTRACT_PG_URL) return process.env.CONTRACT_PG_URL;
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const c = await new PostgreSqlContainer(PG_IMAGE)
      .withTmpFs({ '/var/lib/postgresql/data': 'rw,size=2g' })
      .withCommand(['postgres', '-c', 'max_connections=400', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_wal_size=128MB'])
      .start();
    const url = `postgres://${c.getUsername()}:${c.getPassword()}@${c.getHost()}:${c.getPort()}/postgres`;
    process.env.CONTRACT_PG_URL = url;
    return url;
  })();
  return serverUrl;
}

export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** jdbc:postgresql://host:port/db for the Java app (credentials go in POSTGRES_USER/PASSWORD). */
export function jdbcParts(url: string): { jdbc: string; user: string; password: string } {
  const u = new URL(url);
  return { jdbc: `jdbc:postgresql://${u.hostname}:${u.port || 5432}${u.pathname}`, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

/** A hash of every migration file + target: the template is rebuilt when they change. */
function migrationsFingerprint(): string {
  const h = createHash('sha256').update(IT_FLYWAY_TARGET);
  for (const dir of IT_LOCATIONS) {
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.sql')) h.update(f).update(readFileSync(join(dir, f)));
  }
  return h.digest('hex').slice(0, 12);
}

let template: Promise<string> | undefined;

/** Name of the migrated template database (created once per server and migration set). */
export function templateDatabase(): Promise<string> {
  if (process.env.CONTRACT_TEMPLATE_DB) return Promise.resolve(process.env.CONTRACT_TEMPLATE_DB);
  template ??= (async () => {
    const name = `contract_tpl_${migrationsFingerprint()}`;
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    try {
      await admin`SELECT pg_advisory_lock(424242)`;
      const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
      if (!exists) {
        const t0 = performance.now();
        const building = `${name}_building_${process.pid}`;
        await admin.unsafe(`CREATE DATABASE ${building}`);
        const sql = postgres(withDatabase(await pgServerUrl(), building), { max: 1, onnotice: () => {} });
        try {
          await migrate(sql, { locations: IT_LOCATIONS, schemas: ['public', 'wiki'], target: IT_FLYWAY_TARGET, outOfOrder: true });
        } finally {
          await sql.end();
        }
        await admin.unsafe(`ALTER DATABASE ${building} RENAME TO ${name}`);
        await admin.unsafe(`ALTER DATABASE ${name} WITH IS_TEMPLATE true`);
        process.env.CONTRACT_TEMPLATE_MS = String(Math.round(performance.now() - t0));
      }
      await admin`SELECT pg_advisory_unlock(424242)`;
    } finally {
      await admin.end();
    }
    process.env.CONTRACT_TEMPLATE_DB = name;
    return name;
  })();
  return template;
}

let counter = 0;

/** CREATE DATABASE <fresh> TEMPLATE <template>; returns its name. */
export async function cloneDatabase(prefix = 'c'): Promise<string> {
  const tpl = await templateDatabase();
  const name = `${prefix}_${process.pid}_${Date.now().toString(36)}_${++counter}`;
  const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
  try {
    // CREATE DATABASE ... TEMPLATE fails while another session is connected to the template.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${tpl}`);
        break;
      } catch (e) {
        if (attempt > 50 || !/being accessed by other users/.test((e as Error).message)) throw e;
        await Bun.sleep(100);
      }
    }
  } finally {
    await admin.end();
  }
  return name;
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export function connect(url: string): Sql {
  return postgres(url, {
    max: 4, onnotice: () => {},
    types: { int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
  });
}
