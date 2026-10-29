import { z } from 'zod';
import { ConfigError } from '../env';
import { defineSection } from '../registry';

// spring.datasource.* + spring.flyway.* (application.yml, application-prod.yml).
const schema = z.object({
  /** postgres:// URL (DATABASE_URL may be jdbc:postgresql://host:port/db?params). */
  url: z.string(),
  user: z.string(),
  password: z.string(),
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  /** spring.datasource.hikari.maximum-pool-size (DB_POOL_SIZE, default 20). */
  poolSize: z.number().int().positive(),
  /** hikari connection-init-sql. */
  /** Milliseconds (hikari connection-init-sql: 5min). */
  idleInTransactionSessionTimeoutMs: z.number().int(),
  flyway: z.object({
    enabled: z.boolean(),
    /** spring.flyway.schemas */
    schemas: z.array(z.string()),
    defaultSchema: z.string(),
    /** Directories with V*__*.sql files, in Flyway location order. */
    locations: z.array(z.string()),
    /** spring.flyway.target (undefined = latest). */
    target: z.string().optional(),
    outOfOrder: z.boolean(),
    baselineOnMigrate: z.boolean(),
    baselineVersion: z.string(),
  }),
});

declare module '../registry' {
  interface ConfigSections { db: z.infer<typeof schema> }
}

/** The prod migrations, the default location (`classpath:db/migration`, Flyway's old classpath path). */
export const MIGRATIONS_DIR = new URL('../../main/resources/db/migration', import.meta.url).pathname;
/** The test-only mirrors (`classpath:db/test-migration`; see their README). */
export const TEST_MIGRATIONS_DIR = new URL('../../test/resources/db/test-migration', import.meta.url).pathname;

/** Parses jdbc:postgresql://host[:port]/db[?k=v] or postgres://user:pass@host/db. */
export function parseDatabaseUrl(raw: string): { host: string; port: number; database: string; user?: string; password?: string; params: URLSearchParams } {
  const s = raw.trim().replace(/^jdbc:/, '');
  let u: URL;
  try {
    u = new URL(s.replace(/^postgresql:/, 'postgres:'));
  } catch {
    throw new ConfigError(`DATABASE_URL '${raw}' is not a valid database URL`);
  }
  return {
    host: u.hostname || 'localhost',
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    params: u.searchParams,
  };
}

function location(loc: string): string {
  // classpath:db/migration -> MIGRATIONS_DIR; filesystem:<path> -> path.
  const l = loc.trim();
  if (l === 'classpath:db/migration') return MIGRATIONS_DIR;
  if (l === 'classpath:db/test-migration') return TEST_MIGRATIONS_DIR;
  if (l.startsWith('filesystem:')) return l.slice('filesystem:'.length);
  if (l.startsWith('classpath:')) throw new ConfigError(`Unsupported Flyway location ${l}`);
  return l;
}

export default defineSection('db', schema, ({ env, hasProfile }) => {
  const parsed = parseDatabaseUrl(env.str('DATABASE_URL', 'jdbc:postgresql://localhost:5432/ceitba_db'));
  const user = parsed.user ?? parsed.params.get('user') ?? env.str('POSTGRES_USER', 'postgres');
  const password = parsed.password ?? parsed.params.get('password') ?? env.str('POSTGRES_PASSWORD', 'postgres');
  const url = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${parsed.host}:${parsed.port}/${encodeURIComponent(parsed.database)}`;
  const target = env.opt('SPRING_FLYWAY_TARGET');
  return {
    url, user, password, host: parsed.host, port: parsed.port, database: parsed.database,
    poolSize: env.int('DB_POOL_SIZE', 20),
    idleInTransactionSessionTimeoutMs: 300_000,
    flyway: {
      enabled: env.bool('SPRING_FLYWAY_ENABLED', true),
      schemas: env.list('SPRING_FLYWAY_SCHEMAS', 'public,wiki'),
      defaultSchema: env.str('SPRING_FLYWAY_DEFAULT_SCHEMA', 'public'),
      locations: env.list('SPRING_FLYWAY_LOCATIONS', 'classpath:db/migration').map(location),
      target: target === 'latest' ? undefined : target,
      outOfOrder: env.bool('SPRING_FLYWAY_OUT_OF_ORDER', true),
      // application-prod.yml: baseline-on-migrate true, baseline-version 1.
      baselineOnMigrate: env.bool('SPRING_FLYWAY_BASELINE_ON_MIGRATE', hasProfile('prod')),
      baselineVersion: env.str('SPRING_FLYWAY_BASELINE_VERSION', '1'),
    },
  };
});
