// The persistence the ported kb classes need, as narrow interfaces (only the
// Spring Data repository methods they call). Tests implement them in memory
// (test/kb/support/inMemoryRepo.ts); the service layer implements them on drizzle.
// There is no unit of work (JPA dirty checking): the ported code calls save() on
// every entity it mutates, inside the same `tx`; a store must persist it then.
// TODO(kb-service): drizzle implementations over src/db/schema/kb.ts, and `Tx` as
// db.transaction(); map Postgres unique violations (SQLSTATE 23505) to DuplicateKeyError.

import type { JsonValue } from './jsonNode';
import type { KbBatchJob, KbLlmEndpoint, KbLlmUsage, KbModel, KbRunRequest } from './types';

export type MaybePromise<T> = T | Promise<T>;

/** TransactionTemplate.execute: runs `fn` in one transaction. */
export type Tx = <T>(fn: () => MaybePromise<T>) => Promise<T>;

/** A transaction runner that just calls through (tests). */
export const noTx: Tx = async (fn) => await fn();

/** DataIntegrityViolationException from a unique index. */
export class DuplicateKeyError extends Error {
  constructor(constraint: string) {
    super(constraint);
    this.name = 'DataIntegrityViolationException';
  }
}

/** repository/kb/KbModelRepository. */
export interface KbModelStore {
  findById(id: string): MaybePromise<KbModel | null>;
  findAll(): MaybePromise<KbModel[]>;
  save(m: KbModel): MaybePromise<KbModel>;
}

/** repository/kb/KbLlmEndpointRepository. */
export interface KbLlmEndpointStore {
  findById(id: string): MaybePromise<KbLlmEndpoint | null>;
  findByName(name: string): MaybePromise<KbLlmEndpoint | null>;
}

/** repository/kb/KbBatchJobRepository. */
export interface KbBatchJobStore {
  findById(id: string): MaybePromise<KbBatchJob | null>;
  /** saveAndFlush: assigns the id; throws DuplicateKeyError on kb_batch_job_once_idx. */
  saveAndFlush(job: KbBatchJob): MaybePromise<KbBatchJob>;
  /** Persists the mutated job (status, error, nextAttemptAt, DO ids...). */
  save(job: KbBatchJob): MaybePromise<KbBatchJob>;
}

/** repository/kb/KbRunRequestRepository. */
export interface KbRunRequestStore {
  findAllById(ids: string[]): MaybePromise<KbRunRequest[]>;
  /** Bulk: status SUBMITTED, batch_job_id = jobId for these custom ids. */
  markSubmitted(jobId: string, customIds: string[]): MaybePromise<number>;
  /** Custom ids of the job's SUBMITTED requests, sorted. */
  submittedIdsOfJob(jobId: string): MaybePromise<string[]>;
  failSubmittedOfJob(jobId: string, error: string): MaybePromise<number>;
}

/** repository/kb/KbRunRepository. */
export interface KbRunStore {
  /** UPDATE kb_run SET status = :status WHERE id = :runId AND status IN (:from). */
  setStatusIf(runId: string, status: string, from: readonly string[]): MaybePromise<number>;
}

/** repository/kb/KbLlmUsageRepository (save only). */
export interface KbLlmUsageStore {
  save(row: KbLlmUsage): MaybePromise<unknown>;
}

export type { JsonValue };
