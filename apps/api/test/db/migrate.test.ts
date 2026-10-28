// The Flyway-compatible runner (src/db/migrate.ts) against what Java's Flyway
// 10.10 wrote: test/fixtures/flyway-history-java-*.json were read from
// flyway_schema_history of databases the jar migrated (prod locations, and
// the IT locations + target 4.52). Rows after V63 / V4.52 were written by
// this runner (the jar is gone), so for them the checksum tests only hold the
// runner to itself.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import prodHistory from '../fixtures/flyway-history-java-prod.json';
import itHistory from '../fixtures/flyway-history-java-it.json';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../../src/config/sections/db';
import { check, compareVersions, flywayChecksum, flywayLockNumber, javaStringHashCode, migrate, readHistory, resolveMigrations, validate, type AppliedMigration } from '../../src/db/migrate';
import { IT_FLYWAY_TARGET, cloneDatabase, dropDatabase, pgServerUrl, withDatabase } from '../../contract/support/pg';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const asApplied = (rows: typeof prodHistory): AppliedMigration[] => rows.map((r) => ({ ...r, installedBy: 'postgres', executionTime: 1, success: true }));

describe('checksums and versions', () => {
  test('everyChecksumMatchesWhatJavaFlywayWrote', () => {
    const resolved = new Map(resolveMigrations([MIGRATIONS_DIR, TEST_MIGRATIONS_DIR]).map((m) => [m.script, m]));
    for (const row of [...prodHistory, ...itHistory].filter((r) => r.type === 'SQL')) {
      const m = resolved.get(row.script)!;
      expect(m, row.script).toBeDefined();
      expect(m.checksum).toBe(row.checksum!);
      expect(m.description).toBe(row.description);
      expect(m.version).toBe(row.version);
    }
  });

  test('checksumIgnoresBomAndLineTerminators', () => {
    expect(flywayChecksum('a\nb\n')).toBe(flywayChecksum('﻿a\r\nb'));
    expect(flywayChecksum('a\rb')).toBe(flywayChecksum('a\nb'));
  });

  test('versionsCompareNumericallyPerSegment', () => {
    expect(compareVersions('4.10', '4.9')).toBe(1);
    expect(compareVersions('4.52', '5')).toBe(-1);
    expect(compareVersions('1.0', '1')).toBe(0);
    expect(compareVersions('1_1', '1.1')).toBe(0);
  });

  test('advisoryLockNumberIsFlywaysOne', () => {
    expect(javaStringHashCode('"public"."flyway_schema_history"')).toBe(javaStringHashCode('"public"."flyway_schema_history"'));
    expect(flywayLockNumber('public')).toBe(77431708279161n + BigInt(javaStringHashCode('"public"."flyway_schema_history"')));
    // String.hashCode of "abc" is 96354 in Java.
    expect(javaStringHashCode('abc')).toBe(96354);
  });

  test('javaHistoriesValidateWithZeroIssuesAndZeroPending', () => {
    const prod = resolveMigrations([MIGRATIONS_DIR]);
    expect(validate(prod, asApplied(prodHistory))).toEqual([]);
    const it = resolveMigrations([MIGRATIONS_DIR, TEST_MIGRATIONS_DIR]);
    expect(validate(it, asApplied(itHistory))).toEqual([]);
  });

  test('aChangedFileIsAChecksumMismatch', () => {
    const prod = resolveMigrations([MIGRATIONS_DIR]);
    const tampered = asApplied(prodHistory).map((r) => (r.script === 'V2__api_keys.sql' ? { ...r, checksum: 1 } : r));
    expect(validate(prod, tampered).map((i) => i.script)).toEqual(['V2__api_keys.sql']);
  });
});

describe('against Postgres', () => {
  test('migratingAFreshDatabaseWritesTheRowsJavaWrites', async () => {
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    const name = `mig_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(withDatabase(await pgServerUrl(), name), { max: 2, onnotice: () => {} });
    try {
      const opts = { locations: [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: '4.53', outOfOrder: true };
      const r = await migrate(sql, opts);
      expect(r.schemaVersion).toBe('4.53');
      const rows = (await readHistory(sql)).map(({ installedRank, version, description, type, script, checksum }) => ({ installedRank, version, description, type, script, checksum }));
      expect(rows).toEqual(itHistory);
      // Idempotent: a second run applies nothing.
      expect((await migrate(sql, opts)).applied).toEqual([]);
      expect(await check(sql, opts)).toEqual({ issues: [], pending: [] });
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  // ProdMigrationsIT: the real production chain (no test mirrors) on an empty database, then
  // SchemaValidationIT's checks on it: every table and column the TS code maps (the drizzle schema,
  // what Hibernate's `validate` checks in Java) exists, and the user table's shape.
  test('productionMigrationsApplyCleanly', async () => {
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    const name = `migp_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(withDatabase(await pgServerUrl(), name), { max: 2, onnotice: () => {} });
    try {
      const opts = { locations: [MIGRATIONS_DIR], schemas: ['public', 'wiki'], outOfOrder: true };
      await migrate(sql, opts);
      expect(await check(sql, opts)).toEqual({ issues: [], pending: [] });
      expect((await sql`SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'sga_synced_at'`)[0]!.n).toBe(0);
      expect(await unmappedColumns(sql)).toEqual([]);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);

  // NewsCategoryMigrationIT: V29 folds legacy category spellings onto the canonical list.
  test('v29MapsCaseAndAccentVariantsAndLeavesUnknownValues', async () => {
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    const name = `mig29_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(withDatabase(await pgServerUrl(), name), { max: 2, onnotice: () => {} });
    const opts = (target: string) => ({ locations: [MIGRATIONS_DIR], schemas: ['public', 'wiki'], defaultSchema: 'public', outOfOrder: true, target });
    try {
      await migrate(sql, opts('28'));
      await sql`INSERT INTO public.articles (id, title, excerpt, category) VALUES
        ('a-acad-upper', 't', 'e', 'ACADÉMICO'), ('a-acad-plain', 't', 'e', 'academico'), ('a-acad-ok', 't', 'e', 'Académico'),
        ('a-dep', 't', 'e', 'DEPORTES'), ('a-cult-space', 't', 'e', ' cultura '), ('a-org', 't', 'e', 'ORGANIZACIONES'),
        ('a-tec', 't', 'e', 'TECNOLOGIA'), ('a-tec-acc', 't', 'e', 'tecnología'), ('a-campus', 't', 'e', 'CAMPUS'),
        ('a-general', 't', 'e', 'general'), ('a-todos', 't', 'e', 'TODOS'), ('a-tech', 't', 'e', 'tech')`;
      await sql`INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category) VALUES
        ('e-dep', 't', '2026-01-01', '10:00', '11:00', 'L', 'DEPORTES'), ('e-acad', 't', '2026-01-01', '10:00', '11:00', 'L', 'ACADÉMICO'),
        ('e-x', 't', '2026-01-01', '10:00', '11:00', 'L', 'workshop')`;
      await sql`INSERT INTO public.analytics_events (type, session_id, category) VALUES ('category_view', 's', 'CULTURA'), ('page_view', 's', NULL)`;
      await migrate(sql, opts('29'));
      const categories = async (table: string) => Object.fromEntries((await sql.unsafe(`SELECT id, category FROM public.${table}`)).map((r) => [r.id, r.category]));
      expect(await categories('articles')).toEqual({
        'a-acad-upper': 'Académico', 'a-acad-plain': 'Académico', 'a-acad-ok': 'Académico', 'a-dep': 'Deportes', 'a-cult-space': 'Cultura',
        'a-org': 'Organizaciones', 'a-tec': 'Tecnología', 'a-tec-acc': 'Tecnología', 'a-campus': 'Campus', 'a-general': 'General',
        'a-todos': 'TODOS', 'a-tech': 'tech',
      });
      expect(await categories('news_events')).toEqual({ 'e-dep': 'Deportes', 'e-acad': 'Académico', 'e-x': 'workshop' });
      expect((await sql`SELECT category FROM public.analytics_events ORDER BY id`).map((r) => r.category)).toEqual(['Cultura', null]);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);

  test('everyRepositoryReachesAnEmptyTable', async () => {
    const db = await cloneDatabase('mig');
    const sql = postgres(withDatabase(await pgServerUrl(), db), { max: 1, onnotice: () => {} });
    try {
      expect(await unmappedColumns(sql)).toEqual([]);
      for (const table of ['careers', 'plan', 'user', 'subject', 'commission', 'plan_subject', 'ceitba_staff']) {
        expect((await sql.unsafe(`SELECT count(*)::int AS n FROM public."${table}"`))[0]!.n).toBe(0);
      }
    } finally {
      await sql.end();
      await dropDatabase(db);
    }
  }, 60_000);

  test('userTableHasUniqueFileNumberAndNoSgaColumn', async () => {
    const db = await cloneDatabase('mig');
    const sql = postgres(withDatabase(await pgServerUrl(), db), { max: 1, onnotice: () => {} });
    try {
      expect((await sql`SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'sga_synced_at'`)[0]!.n).toBe(0);
      expect(String((await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'user_file_number_key'`)[0]!.indexdef))
        .toStartWith('CREATE UNIQUE INDEX');
    } finally {
      await sql.end();
      await dropDatabase(db);
    }
  }, 60_000);

  test('theContractTemplateHasZeroPendingAndZeroMismatches', async () => {
    const db = await cloneDatabase('mig');
    const sql = postgres(withDatabase(await pgServerUrl(), db), { max: 1, onnotice: () => {} });
    try {
      expect(await check(sql, { locations: [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: IT_FLYWAY_TARGET, outOfOrder: true }))
        .toEqual({ issues: [], pending: [] });
    } finally {
      await sql.end();
      await dropDatabase(db);
    }
  }, 60_000);
});

// Production was not created by Flyway: Prisma built the schema (V1 with `user.career_id` UUID and no FK,
// plus wiki.subject_bookmarks), the runbook (docs/MIGRATION-RUNBOOK.md, on main) fixed career_id by hand, then
// Flyway baselined at 1 (`flyway:baseline` and the prod profile's baseline-on-migrate write the same row) and
// the jar applied V1.1+ on top. Java's rows on such a database are prodHistory with its first two rows
// (rank 0 schema creation, rank 1 V1) replaced by the BASELINE row: verified against the jar of b515215, both paths.
const PRISMA_ERA_CAREER_FIX = `
  UPDATE public."user" SET career_id = NULL
    WHERE career_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.careers c WHERE c.id::text = career_id::text);
  ALTER TABLE public."user" ALTER COLUMN career_id TYPE VARCHAR(25) USING career_id::text;
  ALTER TABLE public."user" ADD CONSTRAINT user_career_id_fkey
    FOREIGN KEY (career_id) REFERENCES public.careers(id) ON DELETE SET NULL ON UPDATE CASCADE;`;

async function prismaEraDatabase(sql: postgres.Sql): Promise<void> {
  const v1 = await Bun.file(join(MIGRATIONS_DIR, 'V1__baseline.sql')).text();
  const fk = `ALTER TABLE "public"."user"
    ADD CONSTRAINT "user_career_id_fkey"
    FOREIGN KEY ("career_id") REFERENCES "public"."careers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;`;
  const prisma = v1.replace(/"career_id"\s+VARCHAR\(25\),\s+-- corrected: was UUID/, '"career_id" UUID,').replace(fk, '');
  expect(prisma).not.toContain('corrected: was UUID');
  expect(prisma).not.toContain(fk);
  await sql.unsafe(prisma).simple();
  await sql.unsafe(`CREATE TABLE public._prisma_migrations (id VARCHAR(36) PRIMARY KEY, migration_name VARCHAR(255) NOT NULL);
    CREATE TABLE wiki.subject_bookmarks (subject_id VARCHAR(25) NOT NULL, user_id UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT subject_bookmarks_pkey PRIMARY KEY (subject_id, user_id));
    INSERT INTO public.careers (id, name, updated_at) VALUES ('X', 'X', now());
    INSERT INTO public."user" (id, email, career_id, updated_at)
      VALUES ('11111111-1111-4111-8111-000000000001', 'a@itba.edu.ar', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now());`).simple();
  await sql.unsafe(PRISMA_ERA_CAREER_FIX).simple();
}

describe('a Prisma-era database baselined at 1 (production)', () => {
  const javaRows = [
    { installedRank: 1, version: '1', description: '<< Flyway Baseline >>', type: 'BASELINE', script: '<< Flyway Baseline >>', checksum: null },
    ...prodHistory.filter((r) => r.installedRank >= 2),
  ];
  const opts = { locations: [MIGRATIONS_DIR], schemas: ['public', 'wiki'], defaultSchema: 'public', outOfOrder: true, baselineOnMigrate: true, baselineVersion: '1' };

  async function withPrismaEraDatabase(fn: (sql: postgres.Sql) => Promise<void>): Promise<void> {
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    const name = `migb_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(withDatabase(await pgServerUrl(), name), { max: 2, onnotice: () => {} });
    try {
      await prismaEraDatabase(sql);
      await fn(sql);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }

  test('baselineOnMigrateWritesTheRowsJavaWroteOnProduction', async () => {
    await withPrismaEraDatabase(async (sql) => {
      const r = await migrate(sql, opts);
      expect(r.applied[0]).toBe('V1.1__add_subject_bookmarks.sql');
      expect(r.applied).not.toContain('V1__baseline.sql');
      const rows = (await readHistory(sql)).map(({ installedRank, version, description, type, script, checksum }) => ({ installedRank, version, description, type, script, checksum }));
      expect(rows).toEqual(javaRows);
      expect((await migrate(sql, opts)).applied).toEqual([]);
      expect(await check(sql, opts)).toEqual({ issues: [], pending: [] });
      expect(await unmappedColumns(sql)).toEqual([]);
      // The Prisma-era user survived with its dangling career cleared, and the FK is there.
      expect((await sql`SELECT career_id FROM public."user"`)[0]!.career_id).toBeNull();
    });
  }, 120_000);

  test('theHistoryJavaWroteValidatesWithZeroIssuesAndZeroPending', async () => {
    await withPrismaEraDatabase(async (sql) => {
      // The rows the jar wrote, then the schema it reached (our runner applies the SQL, history replaced).
      await migrate(sql, opts);
      await sql`DELETE FROM public.flyway_schema_history`;
      for (const r of javaRows) {
        await sql`INSERT INTO public.flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
                  VALUES (${r.installedRank}, ${r.version}, ${r.description}, ${r.type}, ${r.script}, ${r.checksum}, 'postgres', 1, true)`;
      }
      expect(await check(sql, opts)).toEqual({ issues: [], pending: [] });
      expect((await migrate(sql, opts)).applied).toEqual([]);
    });
  }, 120_000);

  test('withoutBaselineOnMigrateANonEmptySchemaIsRefused', async () => {
    await withPrismaEraDatabase(async (sql) => {
      await expect(migrate(sql, { ...opts, baselineOnMigrate: false })).rejects.toThrow(/non-empty schema/);
    });
  }, 120_000);
});

// Live: the jar's own Flyway migrates a fresh database, then our runner validates it.
// The Java app is deleted: CONTRACT_JAR names a jar built from the last Java commit.
const JAR = process.env.CONTRACT_JAR ?? '';
const JAVA = process.env.CONTRACT_JAVA_HOME ?? join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home');
describe.skipIf(!JAR || !existsSync(JAR) || !existsSync(JAVA))('against a database Java Flyway migrated', () => {
  test('zeroPendingAndZeroChecksumMismatches', async () => {
    const admin = postgres(await pgServerUrl(), { max: 1, onnotice: () => {} });
    const name = `migj_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(withDatabase(await pgServerUrl(), name));
    const port = 19000 + Math.floor(Math.random() * 900);
    const proc = Bun.spawn([join(JAVA, 'bin', 'java'), '-XX:TieredStopAtLevel=1', '-jar', JAR], {
      env: {
        PATH: process.env.PATH ?? '', SPRING_PROFILES_ACTIVE: 'contract', PORT: String(port), AUTH_JWT_SECRET: TEST_JWT_SECRET,
        DATABASE_URL: `jdbc:postgresql://${url.hostname}:${url.port}${url.pathname}`, POSTGRES_USER: decodeURIComponent(url.username), POSTGRES_PASSWORD: decodeURIComponent(url.password),
        ITBA_API_USE_FAKE: 'true',
      },
      stdout: 'ignore', stderr: 'ignore',
    });
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      for (let i = 0; i < 240; i++) {
        const ok = await fetch(`http://127.0.0.1:${port}/api/actuator/health`).then((r) => r.ok, () => false);
        if (ok) break;
        await Bun.sleep(250);
      }
      expect(await check(sql, { locations: [MIGRATIONS_DIR], schemas: ['public', 'wiki'], outOfOrder: true })).toEqual({ issues: [], pending: [] });
      const rows = (await readHistory(sql)).map(({ installedRank, version, description, type, script, checksum }) => ({ installedRank, version, description, type, script, checksum }));
      expect(rows).toEqual(prodHistory);
    } finally {
      proc.kill();
      await proc.exited;
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }, 90_000);
});

/** Every table/column of the drizzle schema that the database lacks (Hibernate's `validate`, in TS). */
async function unmappedColumns(sql: postgres.Sql): Promise<string[]> {
  const missing: string[] = [];
  const tables = Object.values(schema).filter((t) => t instanceof PgTable);
  if (tables.length < 50) throw new Error(`only ${tables.length} drizzle tables found`);
  const existing = new Set((await sql`SELECT table_schema || '.' || table_name || '.' || column_name AS c FROM information_schema.columns`).map((r) => r.c as string));
  for (const t of tables) {
    const cfg = getTableConfig(t as PgTable);
    for (const c of cfg.columns) {
      const key = `${cfg.schema ?? 'public'}.${cfg.name}.${c.name}`;
      if (!existing.has(key)) missing.push(key);
    }
  }
  return missing;
}
