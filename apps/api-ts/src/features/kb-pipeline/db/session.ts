// A small JPA persistence context for the pipeline, so the ported engine can
// keep Java's shape (mutate entities inside a transaction, no explicit save):
//
//   inTx(db, fn)   TransactionTemplate.execute: a drizzle transaction plus a
//                  Session in AsyncLocalStorage; nested calls join it
//                  (PROPAGATION_REQUIRED).
//   Session        identity map (one instance per row per transaction),
//                  snapshots of every loaded/persisted entity, and a flush
//                  that UPDATEs only the columns that changed (Hibernate's
//                  @DynamicUpdate; KbRun relies on it so writing totals never
//                  overwrites a concurrent cancel's status). Every query
//                  flushes first (FlushMode.AUTO) and the commit flushes last.
//   persist()      INSERTs at once (saveAndFlush), so unique violations surface
//                  where Java's saveAndFlush raises them.

import { AsyncLocalStorage } from 'node:async_hooks';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database, Tx as DbTx } from '../../../db/client';
import { isUniqueViolation, sqlState } from '../../../db/client';
import { DuplicateKeyError } from '../../kb/logic/ports';

export type ColType = 'text' | 'int' | 'bigint' | 'bool' | 'numeric' | 'jsonb' | 'timestamptz' | 'uuid' | 'uuid[]' | 'text[]';

/** One column: its SQL type and how to read the bind value off the entity. */
export type Column<E> = readonly [ColType, (e: E) => unknown];

export interface Mapper<E> {
  /** Schema-qualified table, e.g. wiki.kb_run. */
  readonly table: string;
  /** Identity of an entity (its primary key as text). */
  key(e: E): string;
  /** WHERE clause selecting the entity's row. */
  where(e: E): SQL;
  readonly columns: Readonly<Record<string, Column<E>>>;
  /** Columns compared by reference instead of by value (large jsonb such as params). */
  readonly byReference?: readonly string[];
  /** @UpdateTimestamp column, set on every UPDATE of the entity. */
  readonly updateTimestamp?: string;
}

interface Tracked {
  mapper: Mapper<unknown>;
  entity: unknown;
  snapshot: Map<string, unknown>;
}

const store = new AsyncLocalStorage<Session>();
const dialect = new PgDialect();
const TABLE = /\b(?:wiki|public)\.("?)([a-z_]+)\1/g;

/** The tables a statement names (Hibernate's query spaces); null when it names none. */
function tablesOf(q: SQL): Set<string> | null {
  const text = dialect.sqlToQuery(q).sql;
  const out = new Set<string>();
  for (const m of text.matchAll(TABLE)) out.add(m[0].replaceAll('"', ''));
  return out.size === 0 ? null : out;
}

/** A Postgres array literal ({"a","b"}) for a list of strings. */
export function arrayLiteral(values: readonly (string | null)[]): string {
  return '{' + values.map((v) => (v === null ? 'NULL' : '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
}

/** `= ANY(...)` over a list (one bind parameter whatever its size). */
export function anyOf(values: readonly string[], type: 'uuid' | 'text' = 'text'): SQL {
  return sql`ANY(${arrayLiteral(values)}::${sql.raw(type)}[])`;
}

function bind(type: ColType, v: unknown): SQL {
  if (v === null || v === undefined) return sql`NULL::${sql.raw(type)}`;
  if (type === 'uuid[]' || type === 'text[]') return sql`${arrayLiteral(v as string[])}::${sql.raw(type)}`;
  return sql`${v}::${sql.raw(type)}`;
}

function comparable(type: ColType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  return type === 'bool' ? Boolean(v) : String(v);
}

export class Session {
  private readonly tracked = new Map<string, Tracked>();
  private flushing = false;

  constructor(readonly tx: DbTx) {}

  private id(mapper: Mapper<unknown>, key: string): string {
    return `${mapper.table}|${key}`;
  }

  private snap<E>(mapper: Mapper<E>, e: E): Map<string, unknown> {
    const s = new Map<string, unknown>();
    for (const [col, [type, get]] of Object.entries(mapper.columns)) {
      const v = get(e);
      s.set(col, mapper.byReference?.includes(col) ? v : comparable(type, v));
    }
    return s;
  }

  /** The managed instance of this row, if loaded in this transaction. */
  find<E>(mapper: Mapper<E>, key: string): E | undefined {
    return this.tracked.get(this.id(mapper as Mapper<unknown>, key))?.entity as E | undefined;
  }

  /** Registers a hydrated row; returns the instance already managed for it, if any. */
  manage<E>(mapper: Mapper<E>, e: E): E {
    const k = this.id(mapper as Mapper<unknown>, mapper.key(e));
    const existing = this.tracked.get(k);
    if (existing) return existing.entity as E;
    this.tracked.set(k, { mapper: mapper as Mapper<unknown>, entity: e, snapshot: this.snap(mapper, e) });
    return e;
  }

  /** INSERT of every column now (Hibernate inserts all of them), then managed. */
  async persist<E>(mapper: Mapper<E>, e: E): Promise<E> {
    await this.flush();
    const cols = Object.entries(mapper.columns);
    const names = sql.raw(cols.map(([c]) => c).join(', '));
    const values = sql.join(cols.map(([, [type, get]]) => bind(type, get(e))), sql`, `);
    try {
      await this.tx.execute(sql`INSERT INTO ${sql.raw(mapper.table)} (${names}) VALUES (${values})`);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateKeyError(String((err as { constraint_name?: string }).constraint_name ?? sqlState(err)));
      throw err;
    }
    this.tracked.set(this.id(mapper as Mapper<unknown>, mapper.key(e)), {
      mapper: mapper as Mapper<unknown>, entity: e, snapshot: this.snap(mapper, e),
    });
    return e;
  }

  /** Writes the changed columns of every managed entity (only those of `tables` when given). */
  async flush(tables: Set<string> | null = null): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const t of this.tracked.values()) {
        if (tables == null || tables.has(t.mapper.table)) await this.flushOne(t);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async flushOne(t: Tracked): Promise<void> {
    const { mapper, entity } = t;
    const now = this.snap(mapper, entity);
    const changed: string[] = [];
    for (const [col, v] of now) if (t.snapshot.get(col) !== v) changed.push(col);
    if (changed.length === 0) return;
    const sets = changed.map((col) => {
      const [type, get] = mapper.columns[col]!;
      return sql`${sql.raw(col)} = ${bind(type, get(entity))}`;
    });
    if (mapper.updateTimestamp && !changed.includes(mapper.updateTimestamp)) {
      sets.push(sql`${sql.raw(mapper.updateTimestamp)} = clock_timestamp()`);
    }
    await this.tx.execute(sql`UPDATE ${sql.raw(mapper.table)} SET ${sql.join(sets, sql`, `)} WHERE ${mapper.where(entity)}`);
    t.snapshot = now;
  }

  /** EntityManager.detach after a flush of that entity. */
  async detach<E>(mapper: Mapper<E>, e: E): Promise<void> {
    const k = this.id(mapper as Mapper<unknown>, mapper.key(e));
    const t = this.tracked.get(k);
    if (!t) return;
    await this.flushOne(t);
    this.tracked.delete(k);
  }

  /** Forgets a row deleted in SQL. */
  forget<E>(mapper: Mapper<E>, key: string): void {
    this.tracked.delete(this.id(mapper as Mapper<unknown>, key));
  }

  /**
   * A query, after flushing the managed entities of the tables it names
   * (FlushMode.AUTO with the query's spaces).
   */
  async query<R = Record<string, unknown>>(q: SQL): Promise<R[]> {
    await this.flush(tablesOf(q));
    return (await this.tx.execute(q)) as unknown as R[];
  }

  /** An UPDATE/DELETE; returns the affected row count. */
  async update(q: SQL): Promise<number> {
    await this.flush(tablesOf(q));
    const r = (await this.tx.execute(q)) as unknown as { count?: number };
    return r.count ?? 0;
  }
}

/** The session of the current transaction (throws outside one). */
export function session(): Session {
  const s = store.getStore();
  if (!s) throw new Error('No kb transaction is open (inTx)');
  return s;
}

export function inSession(): boolean {
  return store.getStore() !== undefined;
}

/**
 * TransactionTemplate.execute: joins the current transaction, else opens one,
 * runs `fn` with its Session and flushes before the commit.
 */
export async function inTx<T>(db: Database, fn: (s: Session) => Promise<T> | T): Promise<T> {
  const current = store.getStore();
  if (current) return fn(current);
  return db.transaction(async (tx) => {
    const s = new Session(tx);
    const result = await store.run(s, () => fn(s));
    await s.flush();
    return result;
  });
}

/** Runs `fn` outside any kb transaction (work that must not join the caller's). */
export function outsideTx<T>(fn: () => T): T {
  return store.exit(fn);
}

/** The logic ports' Tx (`<T>(fn) => Promise<T>`) over a database. */
export function txRunner(db: Database): <T>(fn: () => T | Promise<T>) => Promise<T> {
  return (fn) => inTx(db, () => fn());
}
