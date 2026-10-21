import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres, { type Sql } from 'postgres';
import type { Config } from '../config';
import * as schema from './schema';

// One Postgres pool per process (Hikari in Java), sized by DB_POOL_SIZE.
//
// Session settings mirror the Java side:
//   - TimeZone = the JVM default zone (TZ; America/Argentina/Buenos_Aires in
//     prod): `now()::date`, `current_date` and text timestamps behave like
//     the JDBC session the Java app opens.
//   - idle_in_transaction_session_timeout = 5min (hikari connection-init-sql).
//
// Type parsing (docs/SERIALIZATION.md): date/time/timestamp/timestamptz stay
// TEXT (drizzle also forces this) and are formatted at the DTO edge with
// src/lib/time.ts; int8 is parsed to a JS number (Java Long -> JSON number);
// numeric stays a string (BigDecimal -> src/lib/json.ts bigDecimal()).

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = PgTransaction<any, Schema, any>;
/** What repositories take: the pool or a transaction. */
export type Db = Database | Tx;

export interface DbHandle {
  db: Database;
  /** The raw postgres.js client (pool). Prefer `db` and drizzle's `sql` template. */
  sql: Sql;
  close(timeoutSeconds?: number): Promise<void>;
}

export function postgresOptions(config: Config, extra: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  return {
    max: config.db.poolSize,
    idle_timeout: 600,
    connect_timeout: 30,
    prepare: true,
    onnotice: () => {},
    connection: {
      application_name: 'ceitba-api',
      TimeZone: config.server.timeZone,
      idle_in_transaction_session_timeout: config.db.idleInTransactionSessionTimeoutMs,
    },
    types: {
      int8: {
        to: 20,
        from: [20],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
    },
    ...extra,
  } satisfies postgres.Options<Record<string, postgres.PostgresType>>;
}

export function createDb(config: Config): DbHandle {
  const sql = postgres(config.db.url, postgresOptions(config));
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: (timeoutSeconds = 5) => sql.end({ timeout: timeoutSeconds }),
  };
}

/**
 * `@Transactional` equivalent. `readOnly` = `@Transactional(readOnly = true)`
 * (the transaction is opened READ ONLY, so a stray write fails like it would
 * under Hibernate's read-only flush mode + the driver's read-only flag).
 * Nested calls with a Tx join the outer transaction (REQUIRED propagation);
 * pass the root Database to get REQUIRES_NEW.
 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  if (isTx(db)) return fn(db);
  return (db as Database).transaction(fn, opts.readOnly ? { accessMode: 'read only' } : undefined);
}

/**
 * Runs `fn` in a savepoint of the open transaction `tx` (drizzle's nested transaction):
 * a throw rolls back only the savepoint's writes and is rethrown, and the outer
 * transaction stays usable (a caught unique violation does not abort it).
 */
export async function withSavepoint<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(fn);
}

function isTx(db: Db): db is Tx {
  return typeof (db as Tx).rollback === 'function';
}

/** SQLSTATE of a postgres error, also when drizzle wrapped it (DrizzleQueryError.cause). */
export function sqlState(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Spring + Hibernate turn SQLSTATE class 23 (integrity constraint) and class 22
 * (data exception, e.g. value too long) into DataIntegrityViolationException,
 * which GlobalExceptionHandler maps to 409 DataIntegrityViolation.
 */
export function isDataIntegrityViolation(err: unknown): boolean {
  const s = sqlState(err);
  return s !== undefined && (s.startsWith('23') || s.startsWith('22'));
}

export function isUniqueViolation(err: unknown): boolean {
  return sqlState(err) === '23505';
}

/**
 * pgvector kNN with iterative index scans (wiki search): `hnsw.iterative_scan`
 * is transaction-local, so it is SET inside the same transaction as the query
 * (spike 5, docs/plans/api-bun-spikes.md).
 */
export async function withIterativeScan<T>(db: Database, fn: (tx: Tx) => Promise<T>, mode: 'strict_order' | 'relaxed_order' = 'strict_order'): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('hnsw.iterative_scan', ${mode}, true)`);
    return fn(tx);
  });
}
