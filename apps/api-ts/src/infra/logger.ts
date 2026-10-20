import pino, { type Logger } from 'pino';
import type { Config } from '../config';

export type { Logger } from 'pino';

/** Structured JSON logs (pino). `logger.child({ name: 'JobLock' })` per component, like SLF4J loggers. */
export function createLogger(config: Pick<Config, 'logging'>): Logger {
  return pino({
    level: config.logging.level,
    base: { app: 'ceitba-api-ts' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(config.logging.pretty ? { transport: { target: 'pino/file', options: { destination: 1 } } } : {}),
  });
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = pino({ level: 'silent' });
