// Flyway-compatible migration runner (Flyway 10.10, the version in the Java jar).
//
// It reads and writes the same public.flyway_schema_history rows Java's Flyway
// does, so the two can take turns on one database (cutover, rollback):
//   - checksum: CRC32 over the file's lines (BOM stripped, line terminators
//     excluded), as a signed int. Verified against every row Java wrote.
//   - versions compare numerically per segment (4.10 > 4.9), `_` == `.`.
//   - description: the part after `__`, underscores -> spaces.
//   - each migration runs in its own transaction together with its history row.
//   - missing schemas are created first and recorded as rank 0
//     `<< Flyway Schema Creation >>` (type SCHEMA, script `"wiki"`).
//   - baseline-on-migrate (prod profile): a non-empty schema without history
//     gets a `<< Flyway Baseline >>` row at baseline-version.
//   - the same advisory lock as Flyway's PostgreSQLAdvisoryLockTemplate
//     (77431708279161 + "\"public\".\"flyway_schema_history\"".hashCode()), so a
//     Java and a TS process never migrate at once.
//   - validation (validateOnMigrate): applied migrations must still resolve
//     locally with the same checksum/description, and no failed rows.
//   - `${...}` placeholders (Flyway defaults + custom) are replaced in the SQL
//     (the checksum is over the raw file, like Flyway).
//
// CLI: bun src/db/migrate.ts [info|migrate|validate]  (uses the app config/env)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32 } from 'node:zlib';
import postgres, { type Sql } from 'postgres';

export const HISTORY_TABLE = 'flyway_schema_history';
const LOCK_MAGIC_NUM = 77431708279161n;

export type MigrationType = 'SQL' | 'SCHEMA' | 'BASELINE';

export interface ResolvedMigration {
  /** null for repeatable (R__) migrations. */
  version: string | null;
  description: string;
  /** Path relative to its location, like Flyway's `script` column. */
  script: string;
  file: string;
  checksum: number;
  repeatable: boolean;
}

export interface AppliedMigration {
  installedRank: number;
  version: string | null;
  description: string;
  type: string;
  script: string;
  checksum: number | null;
  installedBy: string;
  executionTime: number;
  success: boolean;
}

export interface MigrateOptions {
  locations: string[];
  /** Schemas Flyway manages; the first is the default unless `defaultSchema` is set. */
  schemas: string[];
  defaultSchema?: string;
  /** Highest version to apply (undefined = latest). */
  target?: string;
  outOfOrder?: boolean;
  baselineOnMigrate?: boolean;
  baselineVersion?: string;
  placeholders?: Record<string, string>;
  /** Called with a line per applied migration. */
  log?: (msg: string) => void;
}

export interface MigrateResult {
  applied: string[];
  pending: string[];
  schemaVersion: string | null;
}

export class MigrationError extends Error {}

// ---------------------------------------------------------------- checksums

/** Flyway's ChecksumCalculator: CRC32 of each line's UTF-8 bytes, BOM stripped, terminators excluded. */
export function flywayChecksum(text: string): number {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  let c = 0;
  // BufferedReader.readLine splits on \n, \r\n and \r.
  for (const line of t.split(/\r\n|\r|\n/)) {
    if (line.length) c = crc32(Buffer.from(line, 'utf8'), c);
  }
  return c | 0;
}

// ----------------------------------------------------------------- versions

export function versionParts(v: string): bigint[] {
  return v.replace(/_/g, '.').split('.').map((p) => BigInt(p === '' ? 0 : p));
}

/** Flyway MigrationVersion.compareTo: numeric per segment, missing segments are 0. */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0n;
    const y = pb[i] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------- resolving

const VERSIONED = /^V([0-9][0-9._]*?)__(.+)\.sql$/;
const REPEATABLE = /^R__(.+)\.sql$/;

function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function resolveMigrations(locations: string[]): ResolvedMigration[] {
  const out: ResolvedMigration[] = [];
  const seen = new Map<string, string>();
  for (const loc of locations) {
    for (const file of walk(loc)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      const v = VERSIONED.exec(name);
      const r = v ? null : REPEATABLE.exec(name);
      if (!v && !r) continue;
      const raw = readFileSync(file, 'utf8');
      const m: ResolvedMigration = {
        version: v ? v[1]!.replace(/_/g, '.') : null,
        description: (v ? v[2]! : r![1]!).replace(/_/g, ' '),
        script: relative(loc, file),
        file,
        checksum: flywayChecksum(raw),
        repeatable: !v,
      };
      if (m.version !== null) {
        const key = versionParts(m.version).join('.').replace(/(\.0)+$/, '');
        const dup = seen.get(key);
        if (dup) throw new MigrationError(`Found more than one migration with version ${m.version}: ${dup}, ${file}`);
        seen.set(key, file);
      }
      out.push(m);
    }
  }
  return out.sort((a, b) => {
    if (a.repeatable !== b.repeatable) return a.repeatable ? 1 : -1;
    if (a.repeatable) return a.description.localeCompare(b.description);
    return compareVersions(a.version!, b.version!);
  });
}

// --------------------------------------------------------------- placeholders

function applyPlaceholders(text: string, ctx: Record<string, string>): string {
  return text.replace(/\$\{([^}]+)\}/g, (whole, key: string) => {
    if (key in ctx) return ctx[key]!;
    throw new MigrationError(`No value provided for placeholder ${whole}`);
  });
}

// ----------------------------------------------------------------- database

/** java.lang.String#hashCode. */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function flywayLockNumber(defaultSchema: string): bigint {
  return LOCK_MAGIC_NUM + BigInt(javaStringHashCode(`"${defaultSchema}"."${HISTORY_TABLE}"`));
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function historyExists(sql: Sql, schema: string): Promise<boolean> {
  const rows = await sql`SELECT to_regclass(${`${q(schema)}.${q(HISTORY_TABLE)}`}) AS t`;
  return rows[0]?.t != null;
}

export async function readHistory(sql: Sql, schema = 'public'): Promise<AppliedMigration[]> {
  if (!(await historyExists(sql, schema))) return [];
  const rows = await sql.unsafe(
    `SELECT installed_rank, version, description, type, script, checksum, installed_by, execution_time, success
       FROM ${q(schema)}.${q(HISTORY_TABLE)} ORDER BY installed_rank`,
  );
  return rows.map((r) => ({
    installedRank: Number(r.installed_rank),
    version: r.version as string | null,
    description: r.description as string,
    type: r.type as string,
    script: r.script as string,
    checksum: r.checksum === null ? null : Number(r.checksum),
    installedBy: r.installed_by as string,
    executionTime: Number(r.execution_time),
    success: Boolean(r.success),
  }));
}

async function createHistoryTable(sql: Sql, schema: string): Promise<void> {
  const t = `${q(schema)}.${q(HISTORY_TABLE)}`;
  // The exact DDL Flyway 10 uses for PostgreSQL (createMetaDataTable.sql).
  await sql.unsafe(`CREATE TABLE ${t} (
    "installed_rank" INT NOT NULL,
    "version" VARCHAR(50),
    "description" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "script" VARCHAR(1000) NOT NULL,
    "checksum" INTEGER,
    "installed_by" VARCHAR(100) NOT NULL,
    "installed_on" TIMESTAMP NOT NULL DEFAULT now(),
    "execution_time" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL
);
ALTER TABLE ${t} ADD CONSTRAINT "${HISTORY_TABLE}_pk" PRIMARY KEY ("installed_rank");
CREATE INDEX "${HISTORY_TABLE}_s_idx" ON ${t} ("success");`).simple();
}

async function insertHistory(sql: Sql, schema: string, row: Omit<AppliedMigration, 'installedBy'> & { installedBy?: string }) {
  await sql.unsafe(
    `INSERT INTO ${q(schema)}.${q(HISTORY_TABLE)}
       (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, current_user), $8, $9)`,
    [row.installedRank, row.version, row.description, row.type, row.script, row.checksum, row.installedBy ?? null,
      row.executionTime, row.success],
  );
}

async function schemaIsEmpty(sql: Sql, schemas: string[]): Promise<boolean> {
  const rows = await sql`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = ANY(${schemas}) AND c.relkind IN ('r','v','m','S','f','p')`;
  return Number(rows[0]?.n ?? 0) === 0;
}

// ----------------------------------------------------------------- validate

export interface ValidationIssue { script: string; message: string }

export function validate(resolved: ResolvedMigration[], applied: AppliedMigration[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byVersion = new Map(resolved.filter((r) => r.version).map((r) => [versionParts(r.version!).join('.').replace(/(\.0)+$/, ''), r]));
  const repeatables = new Map(resolved.filter((r) => r.repeatable).map((r) => [r.description, r]));
  for (const a of applied) {
    if (a.type === 'SCHEMA' || a.type === 'BASELINE') continue;
    if (!a.success) {
      issues.push({ script: a.script, message: `Detected failed migration to version ${a.version} (${a.description})` });
      continue;
    }
    if (a.version === null) {
      const r = repeatables.get(a.description);
      if (!r) issues.push({ script: a.script, message: `Detected applied migration not resolved locally: ${a.description}` });
      continue;
    }
    const r = byVersion.get(versionParts(a.version).join('.').replace(/(\.0)+$/, ''));
    if (!r) {
      issues.push({ script: a.script, message: `Detected applied migration not resolved locally: ${a.version}` });
      continue;
    }
    if (r.checksum !== a.checksum) {
      issues.push({ script: a.script, message: `Migration checksum mismatch for migration version ${a.version}: applied ${a.checksum}, resolved locally ${r.checksum}` });
    }
    if (r.description !== a.description) {
      issues.push({ script: a.script, message: `Migration description mismatch for migration version ${a.version}: applied '${a.description}', resolved locally '${r.description}'` });
    }
  }
  return issues;
}

/** Migrations that `migrate` would apply now. */
export function pendingMigrations(resolved: ResolvedMigration[], applied: AppliedMigration[], opts: Pick<MigrateOptions, 'target' | 'outOfOrder'>): ResolvedMigration[] {
  const appliedVersions = new Set(applied.filter((a) => a.version !== null && a.type !== 'SCHEMA').map((a) => versionParts(a.version!).join('.').replace(/(\.0)+$/, '')));
  const baseline = applied.find((a) => a.type === 'BASELINE');
  const versions = applied.filter((a) => a.version !== null && a.success).map((a) => a.version!);
  const maxApplied = versions.length ? versions.reduce((m, v) => (compareVersions(v, m) > 0 ? v : m)) : null;
  const latestRepeatable = new Map<string, number | null>();
  for (const a of applied) if (a.version === null && a.type === 'SQL' && a.success) latestRepeatable.set(a.description, a.checksum);
  return resolved.filter((r) => {
    if (r.repeatable) return latestRepeatable.get(r.description) !== r.checksum;
    const v = r.version!;
    if (appliedVersions.has(versionParts(v).join('.').replace(/(\.0)+$/, ''))) return false;
    if (baseline?.version && compareVersions(v, baseline.version) <= 0) return false;
    if (opts.target && compareVersions(v, opts.target) > 0) return false;
    if (maxApplied && compareVersions(v, maxApplied) < 0 && !opts.outOfOrder) return false;
    return true;
  });
}

// ------------------------------------------------------------------ migrate

export async function migrate(sql: Sql, opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? (() => {});
  const schema = opts.defaultSchema ?? opts.schemas[0] ?? 'public';
  const resolved = resolveMigrations(opts.locations);
  const lock = flywayLockNumber(schema);

  return sql.reserve().then(async (conn) => {
    try {
      await conn`SELECT pg_advisory_lock(${lock.toString()}::bigint)`;
      try {
        let applied = await readHistory(conn, schema);
        let rank = applied.reduce((m, a) => Math.max(m, a.installedRank), 0);
        if (applied.length === 0 && !(await historyExists(conn, schema))) {
          // Create missing schemas (recorded as rank 0), then the history table.
          const existing = new Set((await conn`SELECT nspname FROM pg_namespace WHERE nspname = ANY(${opts.schemas})`).map((r) => r.nspname as string));
          const created: string[] = [];
          const wasEmpty = await schemaIsEmpty(conn, opts.schemas);
          for (const s of opts.schemas) {
            if (!existing.has(s)) {
              await conn.unsafe(`CREATE SCHEMA ${q(s)}`);
              created.push(s);
            }
          }
          await createHistoryTable(conn, schema);
          if (created.length) {
            await insertHistory(conn, schema, {
              installedRank: 0, version: null, description: '<< Flyway Schema Creation >>', type: 'SCHEMA',
              script: created.map((s) => `"${s}"`).join(','), checksum: null, executionTime: 0, success: true,
            });
          } else if (!wasEmpty) {
            if (!opts.baselineOnMigrate) {
              throw new MigrationError(`Found non-empty schema(s) ${opts.schemas.map((s) => `"${s}"`).join(',')} but no schema history table. Use baseline() or set baselineOnMigrate to true to initialize the schema history table.`);
            }
            rank = 1;
            await insertHistory(conn, schema, {
              installedRank: 1, version: opts.baselineVersion ?? '1', description: '<< Flyway Baseline >>', type: 'BASELINE',
              script: '<< Flyway Baseline >>', checksum: null, executionTime: 0, success: true,
            });
          }
          applied = await readHistory(conn, schema);
        }

        const issues = validate(resolved.filter((r) => !opts.target || r.repeatable || compareVersions(r.version!, opts.target) <= 0 || applied.some((a) => a.version === r.version)), applied);
        if (issues.length) throw new MigrationError(`Validate failed: Migrations have failed validation\n${issues.map((i) => `${i.message} (${i.script})`).join('\n')}`);

        const pending = pendingMigrations(resolved, applied, opts);
        const ctx = await placeholderContext(conn, schema, opts.placeholders ?? {});
        const done: string[] = [];
        for (const m of pending) {
          const text = applyPlaceholders(readFileSync(m.file, 'utf8').replace(/^﻿/, ''), { ...ctx, 'flyway:filename': m.script });
          const started = performance.now();
          rank += 1;
          const thisRank = rank;
          // A reserved connection has no begin(): the transaction is explicit.
          await conn.unsafe('BEGIN');
          try {
            await conn.unsafe(text).simple();
            await insertHistory(conn, schema, {
              installedRank: thisRank, version: m.version, description: m.description, type: 'SQL', script: m.script,
              checksum: m.checksum, executionTime: Math.round(performance.now() - started), success: true,
            });
            await conn.unsafe('COMMIT');
          } catch (e) {
            await conn.unsafe('ROLLBACK').catch(() => {});
            throw new MigrationError(`Migration ${m.script} failed: ${(e as Error).message}`);
          }
          log(`Migrating schema "${schema}" to version "${m.version ?? m.description} - ${m.description}"`);
          done.push(m.script);
        }
        const after = await readHistory(conn, schema);
        const versions = after.filter((a) => a.version && a.success).map((a) => a.version!);
        return {
          applied: done,
          pending: pendingMigrations(resolved, after, opts).map((m) => m.script),
          schemaVersion: versions.length ? versions.reduce((mx, v) => (compareVersions(v, mx) > 0 ? v : mx)) : null,
        };
      } finally {
        await conn`SELECT pg_advisory_unlock(${lock.toString()}::bigint)`.catch(() => {});
      }
    } finally {
      conn.release();
    }
  });
}

async function placeholderContext(sql: Sql, schema: string, custom: Record<string, string>): Promise<Record<string, string>> {
  const [row] = await sql`SELECT current_user AS u, current_database() AS d`;
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  return {
    'flyway:defaultSchema': schema,
    'flyway:user': String(row?.u ?? ''),
    'flyway:database': String(row?.d ?? ''),
    'flyway:timestamp': ts,
    'flyway:workingDirectory': process.cwd(),
    'flyway:table': HISTORY_TABLE,
    ...custom,
  };
}

/** Validation only (Flyway validate): checksum/description/failed issues + pending list. */
export async function check(sql: Sql, opts: MigrateOptions): Promise<{ issues: ValidationIssue[]; pending: string[] }> {
  const schema = opts.defaultSchema ?? opts.schemas[0] ?? 'public';
  const resolved = resolveMigrations(opts.locations);
  const applied = await readHistory(sql, schema);
  return {
    issues: validate(resolved, applied),
    pending: pendingMigrations(resolved, applied, opts).map((m) => m.script),
  };
}

// --------------------------------------------------------------------- CLI

if (import.meta.main) {
  const { loadConfig } = await import('../config');
  const { dedicatedSessionOptions } = await import('./session');
  const config = await loadConfig();
  const cmd = process.argv[2] ?? 'migrate';
  const sql = postgres(config.db.url, dedicatedSessionOptions(config, 'ceitba-api migrate', { connect_timeout: 30, prepare: true }));
  const opts: MigrateOptions = {
    locations: config.db.flyway.locations,
    schemas: config.db.flyway.schemas,
    defaultSchema: config.db.flyway.defaultSchema,
    target: config.db.flyway.target,
    outOfOrder: config.db.flyway.outOfOrder,
    baselineOnMigrate: config.db.flyway.baselineOnMigrate,
    baselineVersion: config.db.flyway.baselineVersion,
    log: (m) => console.log(m),
  };
  try {
    if (cmd === 'migrate') {
      const r = await migrate(sql, opts);
      console.log(`Applied ${r.applied.length} migration(s); schema version ${r.schemaVersion}; pending ${r.pending.length}`);
    } else if (cmd === 'validate' || cmd === 'info') {
      const r = await check(sql, opts);
      for (const i of r.issues) console.log(`INVALID ${i.script}: ${i.message}`);
      for (const p of r.pending) console.log(`PENDING ${p}`);
      console.log(`${r.issues.length} issue(s), ${r.pending.length} pending`);
      if (cmd === 'validate' && r.issues.length) process.exitCode = 1;
    } else {
      console.error(`Unknown command ${cmd} (migrate | validate | info)`);
      process.exitCode = 2;
    }
  } finally {
    await sql.end();
  }
}
