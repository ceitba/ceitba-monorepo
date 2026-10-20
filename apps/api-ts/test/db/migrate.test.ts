// The Flyway-compatible runner (src/db/migrate.ts) against what Java's Flyway
// 10.10 wrote: test/fixtures/flyway-history-java-*.json were read from
// flyway_schema_history of databases the jar migrated (prod locations, and
// the IT locations + target 4.52).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import prodHistory from '../fixtures/flyway-history-java-prod.json';
import itHistory from '../fixtures/flyway-history-java-it.json';
import { JAVA_MIGRATIONS_DIR, JAVA_TEST_MIGRATIONS_DIR } from '../../src/config/sections/db';
import { check, compareVersions, flywayChecksum, flywayLockNumber, javaStringHashCode, migrate, readHistory, resolveMigrations, validate, type AppliedMigration } from '../../src/db/migrate';
import { cloneDatabase, dropDatabase, pgServerUrl, withDatabase } from '../../contract/support/pg';

const asApplied = (rows: typeof prodHistory): AppliedMigration[] => rows.map((r) => ({ ...r, installedBy: 'postgres', executionTime: 1, success: true }));

describe('checksums and versions', () => {
  test('everyChecksumMatchesWhatJavaFlywayWrote', () => {
    const resolved = new Map(resolveMigrations([JAVA_MIGRATIONS_DIR, JAVA_TEST_MIGRATIONS_DIR]).map((m) => [m.script, m]));
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
    const prod = resolveMigrations([JAVA_MIGRATIONS_DIR]);
    expect(validate(prod, asApplied(prodHistory))).toEqual([]);
    const it = resolveMigrations([JAVA_MIGRATIONS_DIR, JAVA_TEST_MIGRATIONS_DIR]);
    expect(validate(it, asApplied(itHistory))).toEqual([]);
  });

  test('aChangedFileIsAChecksumMismatch', () => {
    const prod = resolveMigrations([JAVA_MIGRATIONS_DIR]);
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
      const opts = { locations: [JAVA_MIGRATIONS_DIR, JAVA_TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: '4.52', outOfOrder: true };
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

  test('theContractTemplateHasZeroPendingAndZeroMismatches', async () => {
    const db = await cloneDatabase('mig');
    const sql = postgres(withDatabase(await pgServerUrl(), db), { max: 1, onnotice: () => {} });
    try {
      expect(await check(sql, { locations: [JAVA_MIGRATIONS_DIR, JAVA_TEST_MIGRATIONS_DIR], schemas: ['public', 'wiki'], target: '4.52', outOfOrder: true }))
        .toEqual({ issues: [], pending: [] });
    } finally {
      await sql.end();
      await dropDatabase(db);
    }
  }, 60_000);
});

// Live: the jar's own Flyway migrates a fresh database, then our runner validates it.
const JAR = join(import.meta.dir, '..', '..', '..', 'api', 'target', 'ceitba-api-1.0.0.jar');
const JAVA = process.env.CONTRACT_JAVA_HOME ?? join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home');
describe.skipIf(!existsSync(JAR) || !existsSync(JAVA))('against a database Java Flyway migrated', () => {
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
      expect(await check(sql, { locations: [JAVA_MIGRATIONS_DIR], schemas: ['public', 'wiki'], outOfOrder: true })).toEqual({ issues: [], pending: [] });
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
