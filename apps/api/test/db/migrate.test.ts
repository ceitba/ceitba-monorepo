// The Flyway-compatible runner (src/db/migrate.ts) against what Java's Flyway
// 10.10 wrote: test/fixtures/flyway-history-java-*.json were read from
// flyway_schema_history of databases the jar migrated (prod locations, and
// the IT locations + target 4.52).
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
import { cloneDatabase, dropDatabase, pgServerUrl, withDatabase } from '../../contract/support/pg';

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
      const opts = { locations: [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: '4.52', outOfOrder: true };
      const r = await migrate(sql, opts);
      expect(r.schemaVersion).toBe('4.52');
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
      expect(await check(sql, { locations: [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: '4.52', outOfOrder: true }))
        .toEqual({ issues: [], pending: [] });
    } finally {
      await sql.end();
      await dropDatabase(db);
    }
  }, 60_000);
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
        PATH: process.env.PATH ?? '', SPRING_PROFILES_ACTIVE: 'contract', PORT: String(port), AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch',
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
