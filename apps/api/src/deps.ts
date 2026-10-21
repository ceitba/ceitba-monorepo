// The dependency container: one plain object built at boot (main.ts) and
// passed to every feature's routes.ts / jobs.ts. Tests build it with
// `buildDeps(config, { overrides })` and swap any part (clock, fakes, db).

import type { Sql } from 'postgres';
import type { Config } from './config';
import { createDb, type Database } from './db/client';
import { createDriveClient, type DriveClient } from './external/drive';
import { createGoogleClients, type GoogleClients } from './external/google';
import { createItbaClient, type ItbaApiClient } from './external/itba';
import { createLlmClients, type LlmClients } from './external/llm';
import { createEmbeddingClient } from './external/llm/embedding';
import { AccessChecks } from './http/auth/checks';
import { UserRateLimiter } from './http/ratelimit';
import { SystemClock, type Clock } from './infra/clock';
import { createLogger, type Logger } from './infra/logger';
import { createMailTransport, type EmailSender } from './infra/mail';
import { createPushGateway, type PushGateway } from './infra/push';
import { createObjectStorage, type ObjectStorage } from './infra/storage';
import { JobLock } from './jobs/joblock';

/** Readiness (Spring's AvailabilityChangeEvent): false once shutdown starts. */
export class Availability {
  acceptingTraffic = true;
  live = true;
}

export interface Deps {
  config: Config;
  log: Logger;
  /** Business "now" (config/ClockConfig, ART). */
  clock: Clock;
  db: Database;
  /** Raw postgres.js pool (prefer `db`). */
  sql: Sql;
  storage: ObjectStorage;
  /** The raw mail transport; the mail feature wraps it with the quota ledger. */
  mailTransport: EmailSender;
  /** null when FCM is not configured (pushes go to the NoOp service). */
  push: PushGateway | null;
  itba: ItbaApiClient;
  drive: DriveClient;
  llm: LlmClients;
  google: GoogleClients;
  userRateLimiter: UserRateLimiter;
  jobLock: JobLock;
  /** Feature-provided @PreAuthorize checks (`@orgAccess.*`). */
  accessChecks: AccessChecks;
  availability: Availability;
  /** Closes the pool and external clients. */
  close(): Promise<void>;
}

export type DepsOverrides = Partial<Omit<Deps, 'config' | 'close'>>;

export async function buildDeps(config: Config, overrides: DepsOverrides = {}): Promise<Deps> {
  const log = overrides.log ?? createLogger(config);
  const clock = overrides.clock ?? new SystemClock();
  const handle = overrides.db ? null : createDb(config);
  const db = overrides.db ?? handle!.db;
  const sql = overrides.sql ?? (handle ? handle.sql : (db as unknown as { $client: Sql }).$client);
  const push = overrides.push !== undefined ? overrides.push : await createPushGateway(config);
  const deps: Deps = {
    config,
    log,
    clock,
    db,
    sql,
    storage: overrides.storage ?? createObjectStorage(config, clock),
    mailTransport: overrides.mailTransport ?? createMailTransport(config, log.child({ component: 'mail' })),
    push,
    itba: overrides.itba ?? createItbaClient(config, db, clock, log),
    drive: overrides.drive ?? createDriveClient(config, log.child({ component: 'drive' })),
    // KbPipelineConfig.embeddingClient (fake / unconfigured / OpenAI-compatible) is selected in llm/embedding.ts.
    llm: overrides.llm ?? { ...createLlmClients(config), embeddings: createEmbeddingClient(config) },
    google: overrides.google ?? createGoogleClients(config.auth),
    userRateLimiter: overrides.userRateLimiter ?? new UserRateLimiter(config.rateLimit),
    jobLock: overrides.jobLock ?? new JobLock(config, log.child({ component: 'JobLock' })),
    accessChecks: overrides.accessChecks ?? new AccessChecks(),
    availability: overrides.availability ?? new Availability(),
    async close() {
      await push?.close?.().catch(() => {});
      if (handle) await handle.close();
    },
  };
  return deps;
}
