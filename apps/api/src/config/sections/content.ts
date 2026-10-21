import { z } from 'zod';
import { defineSection } from '../registry';

// drive-sync.*, mail.*, spring.mail.*, org-mail.*, events.*, digest.* (application.yml).
const schema = z.object({
  driveSync: z.object({
    enabled: z.boolean(),
    intervalMs: z.number(),
    runBudgetMs: z.number(),
    serviceAccountJson: z.string(),
    useFake: z.boolean(),
    maxFileBytes: z.number().int(),
    fakeDemoOwners: z.array(z.string()),
    sourceBudgetMs: z.number(),
    referenceAboveBytes: z.number().int(),
    maxItemsPerSource: z.number().int(),
    maxDepth: z.number().int(),
    communityEnabled: z.boolean(),
    communityOnlyCodes: z.array(z.string()),
  }),
  mail: z.object({
    enabled: z.boolean(),
    /** gmail-api | smtp | log */
    transport: z.string(),
    oauthRedirectUri: z.string(),
    tokenEncryptionKey: z.string(),
    logSends: z.boolean(),
    from: z.string(),
    /** MAIL_DAILY_LIMIT, falling back to DIGEST_DAILY_LIMIT. */
    dailyLimit: z.number().int(),
    backoffInitialMs: z.number(),
    backoffMaxMs: z.number(),
    quotaPauseMs: z.number(),
    retentionSendLogMs: z.number(),
    retentionTrackingMs: z.number(),
    smtp: z.object({
      host: z.string(), port: z.number().int(), username: z.string(), password: z.string(),
      connectionTimeoutMs: z.number(), timeoutMs: z.number(), writeTimeoutMs: z.number(),
    }),
  }),
  orgMail: z.object({
    allowedDomain: z.string(), dailyLimit: z.number().int(), weeklyLimit: z.number().int(), jobsEnabled: z.boolean(),
    tickIntervalMs: z.number(),
  }),
  events: z.object({ remindersEnabled: z.boolean() }),
  digest: z.object({
    publicBaseUrl: z.string(),
    apiBaseUrl: z.string(),
    allowedDomains: z.array(z.string()),
    trackingEnabled: z.boolean(),
    sendIntervalMs: z.number(),
    tickIntervalMs: z.number(),
    jobsEnabled: z.boolean(),
    personal: z.object({
      wikiBaseUrl: z.string(), schedulerUrl: z.string(), voteTokenTtlMs: z.number(),
      maxWikiLinks: z.number().int(), maxCorrections: z.number().int(),
    }),
  }),
});

declare module '../registry' {
  interface ConfigSections { content: z.infer<typeof schema> }
}

export default defineSection('content', schema, ({ env }) => ({
  driveSync: {
    enabled: env.bool('DRIVE_SYNC_ENABLED', false),
    intervalMs: env.duration('DRIVE_SYNC_INTERVAL', 'PT30M'),
    runBudgetMs: env.duration('DRIVE_SYNC_RUN_BUDGET', 'PT10M'),
    serviceAccountJson: env.str('DRIVE_SYNC_SERVICE_ACCOUNT_JSON', ''),
    useFake: env.bool('DRIVE_SYNC_USE_FAKE', false),
    maxFileBytes: env.int('DRIVE_SYNC_MAX_FILE_BYTES', 52428800),
    fakeDemoOwners: env.list('DRIVE_SYNC_FAKE_DEMO_OWNERS', ''),
    sourceBudgetMs: env.duration('DRIVE_SYNC_SOURCE_BUDGET', 'PT3M'),
    referenceAboveBytes: env.int('DRIVE_SYNC_REFERENCE_ABOVE_BYTES', 20971520),
    maxItemsPerSource: env.int('DRIVE_SYNC_MAX_ITEMS_PER_SOURCE', 20000),
    maxDepth: env.int('DRIVE_SYNC_MAX_DEPTH', 30),
    communityEnabled: env.bool('DRIVE_SYNC_COMMUNITY_ENABLED', true),
    communityOnlyCodes: env.list('DRIVE_SYNC_COMMUNITY_ONLY_CODES', ''),
  },
  mail: {
    enabled: env.bool('MAIL_ENABLED', false),
    transport: env.str('MAIL_TRANSPORT', 'gmail-api'),
    oauthRedirectUri: env.str('GOOGLE_MAIL_REDIRECT_URI', 'http://localhost:8080/api/v1/mail/accounts/oauth/callback'),
    tokenEncryptionKey: env.str('MAIL_TOKEN_ENCRYPTION_KEY', ''),
    logSends: env.bool('MAIL_LOG_SENDS', false),
    from: env.str('MAIL_FROM', 'CEITBA <ceitba@itba.edu.ar>'),
    dailyLimit: env.int('MAIL_DAILY_LIMIT', env.int('DIGEST_DAILY_LIMIT', 1500)),
    backoffInitialMs: env.duration('MAIL_BACKOFF_INITIAL', 'PT5M'),
    backoffMaxMs: env.duration('MAIL_BACKOFF_MAX', 'PT1H'),
    quotaPauseMs: env.duration('MAIL_QUOTA_PAUSE', 'PT24H'),
    retentionSendLogMs: env.duration('MAIL_RETENTION_SEND_LOG', 'P30D'),
    retentionTrackingMs: env.duration('MAIL_RETENTION_TRACKING', 'P180D'),
    smtp: {
      host: env.str('MAIL_HOST', 'smtp.gmail.com'),
      port: env.int('MAIL_PORT', 587),
      username: env.str('MAIL_USERNAME', ''),
      password: env.str('MAIL_PASSWORD', ''),
      connectionTimeoutMs: 10000, timeoutMs: 20000, writeTimeoutMs: 20000,
    },
  },
  orgMail: {
    allowedDomain: env.str('ORG_MAIL_ALLOWED_DOMAIN', 'itba.edu.ar'),
    dailyLimit: env.int('ORG_MAIL_DAILY_LIMIT', 400),
    weeklyLimit: env.int('ORG_MAIL_WEEKLY_LIMIT', 3),
    jobsEnabled: env.bool('ORG_MAIL_JOBS_ENABLED', true),
    // OrgMailJob: fixedDelayString = "${org-mail.tick-interval:PT2M}" (not in application.yml).
    tickIntervalMs: env.duration('ORG_MAIL_TICK_INTERVAL', 'PT2M'),
  },
  events: { remindersEnabled: env.bool('EVENT_REMINDERS_ENABLED', true) },
  digest: {
    publicBaseUrl: env.str('DIGEST_PUBLIC_BASE_URL', 'https://ceitba.org.ar/newsletter'),
    apiBaseUrl: env.str('DIGEST_API_BASE_URL', 'https://ceitba.org.ar/api'),
    allowedDomains: env.list('DIGEST_ALLOWED_DOMAINS', 'itba.edu.ar'),
    trackingEnabled: env.bool('DIGEST_TRACKING_ENABLED', true),
    sendIntervalMs: env.duration('DIGEST_SEND_INTERVAL', 'PT1S'),
    tickIntervalMs: env.duration('DIGEST_TICK_INTERVAL', 'PT5M'),
    jobsEnabled: env.bool('DIGEST_JOBS_ENABLED', true),
    personal: {
      wikiBaseUrl: env.str('DIGEST_WIKI_BASE_URL', 'https://ceitba.org.ar/apuntes'),
      schedulerUrl: env.str('DIGEST_SCHEDULER_URL', 'https://ceitba.org.ar/app/horario'),
      voteTokenTtlMs: env.duration('DIGEST_VOTE_TOKEN_TTL', 'P14D'),
      maxWikiLinks: env.int('DIGEST_MAX_WIKI_LINKS', 5),
      maxCorrections: env.int('DIGEST_MAX_CORRECTIONS', 3),
    },
  },
}));
