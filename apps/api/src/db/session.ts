// Options for a dedicated, single-connection postgres.js client that holds
// SESSION state (a session-level advisory lock): the JobLock connection and
// the migration connection (Flyway's advisory lock).
//
// postgres.js recycles connections on its own, which silently ends the
// session and with it every session-level lock while the holder still thinks
// it owns it:
//   - max_lifetime: the default is a random 30-60 min (postgres/src/index.js
//     `max_lifetime()`); when it fires, the connection is ended at the next
//     idle moment (between two queries, or after the next query of a reserved
//     connection). `null` (or 0) disables the timer; it must be set
//     explicitly, otherwise PGMAX_LIFETIME from the environment applies.
//   - idle_timeout: `0` disables it (same env rule: PGIDLE_TIMEOUT).
// keep_alive only sets TCP keepalive (it never closes a healthy socket) and
// backoff only delays a reconnect after a close, so neither ends a session.
// A connection lost to the network still ends the session: the holder
// notices it when the unlock answers false (see JobLock).

import type postgres from 'postgres';
import type { Config } from '../config';

export function dedicatedSessionOptions(config: Config, applicationName: string, extra: { connect_timeout?: number; prepare?: boolean } = {}) {
  return {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: applicationName, TimeZone: config.server.timeZone },
    ...extra,
  } satisfies postgres.Options<Record<string, postgres.PostgresType>>;
}
