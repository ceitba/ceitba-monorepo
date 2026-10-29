import pino, { type Logger } from 'pino';
import type { Config } from '../config';
import { redactSerializedError } from '../lib/redact';

export type { Logger } from 'pino';

/** pino's err serializer, then every URL in it loses its query string and userinfo (src/lib/redact.ts). */
export const errSerializer = (e: unknown) => redactSerializedError(pino.stdSerializers.err(e as Error));

/** Structured JSON logs (pino). `logger.child({ name: 'JobLock' })` per component, like SLF4J loggers. */
export function createLogger(config: Pick<Config, 'logging'>): Logger {
  return pino({
    level: config.logging.level,
    base: { app: 'ceitba-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Errors lose the query string / userinfo of every URL they carry (presigned signatures, Bun fetch errors'
    // `path`): src/lib/redact.ts. Clients with a secret in the URL PATH (ITBA) scrub it themselves.
    serializers: { err: errSerializer },
    ...(config.logging.pretty ? { transport: { target: 'pino/file', options: { destination: 1 } } } : {}),
  });
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = pino({ level: 'silent' });
