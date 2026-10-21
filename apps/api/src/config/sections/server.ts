import { z } from 'zod';
import { defineSection } from '../registry';

// server.*, shutdown.drain, spring.lifecycle / spring.task shutdown (application.yml).
const schema = z.object({
  /** 0 = an ephemeral port (tests). */
  port: z.number().int().min(0),
  /** server.servlet.context-path */
  contextPath: z.literal('/api'),
  /** shutdown.drain (SHUTDOWN_DRAIN, default PT0S): readiness DOWN this long before closing (config/ShutdownDrain). */
  shutdownDrainMs: z.number().min(0),
  /** spring.lifecycle.timeout-per-shutdown-phase: upper bound for in-flight requests. */
  shutdownTimeoutMs: z.number().positive(),
  /** spring.task.scheduling.shutdown.await-termination-period: wait for running jobs. */
  jobsShutdownTimeoutMs: z.number().positive(),
  /** spring.task.execution.shutdown.await-termination-period: background work (digest sender...). */
  tasksShutdownTimeoutMs: z.number().positive(),
  /** Value reported as `environment` by GET /api/ (HealthController: spring.profiles.active). */
  environment: z.string(),
  /** JVM default time zone equivalent (TZ env; prod image sets America/Argentina/Buenos_Aires). */
  timeZone: z.string(),
  /**
   * JVM default locale equivalent, used for Bean Validation messages when a
   * request has no Accept-Language (TS-only knob, JAVA_DEFAULT_LOCALE, default
   * en_US like the eclipse-temurin image's LANG).
   */
  defaultLocale: z.object({ language: z.string(), country: z.string() }),
});

declare module '../registry' {
  interface ConfigSections { server: z.infer<typeof schema> }
}

export default defineSection('server', schema, ({ env }) => ({
  port: env.int('PORT', 8080),
  contextPath: '/api',
  shutdownDrainMs: Math.max(0, env.duration('SHUTDOWN_DRAIN', 'PT0S')),
  shutdownTimeoutMs: 60_000,
  jobsShutdownTimeoutMs: 30_000,
  tasksShutdownTimeoutMs: 60_000,
  // HealthController: @Value("${spring.profiles.active:development}"); application.yml sets `dev`.
  environment: env.str('SPRING_PROFILES_ACTIVE', 'dev'),
  timeZone: env.opt('TZ') ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  defaultLocale: (() => {
    const [language, country] = env.str('JAVA_DEFAULT_LOCALE', 'en_US').split(/[-_]/);
    return { language: (language ?? 'en').toLowerCase(), country: (country ?? '').toUpperCase() };
  })(),
}));
