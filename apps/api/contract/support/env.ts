// The environment both servers get in contract runs: apps/api/src/test/resources/application.yml
// translated to the env vars the MAIN application.yml reads (the server runs
// with its real config + these overrides, the way production does).
//
// IT test profile                          -> env here
//   auth.jwt.secret / ttl-days: 1          -> AUTH_JWT_SECRET / AUTH_JWT_TTL_DAYS=1
//   auth.google.* dummy client             -> GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI
//   auth.allowed-domains/-emails/sync key  -> AUTH_ALLOWED_DOMAINS / AUTH_ALLOWED_EMAILS / AUTH_SYNC_API_KEY
//   itba.api.use-fake: true                -> ITBA_API_USE_FAKE=true
//   spring.flyway (pre-migrated template)  -> SPRING_FLYWAY_ENABLED=false
//   rate-limit.enabled: false              -> RATE_LIMIT_ENABLED=false
//   kb.llm/embeddings fakes, no background -> KB_LLM_USE_FAKE, KB_EMBEDDING_USE_FAKE, KB_EMBEDDINGS_ENABLED=false, KB_PIPELINE_BACKGROUND=false
//   mail.log-sends: true                   -> MAIL_LOG_SENDS=true
//   digest.jobs-enabled false, send 0s     -> DIGEST_JOBS_ENABLED=false, DIGEST_SEND_INTERVAL=PT0S
//   events.reminders-enabled: false        -> EVENT_REMINDERS_ENABLED=false
//   org-mail.jobs-enabled: false           -> ORG_MAIL_JOBS_ENABLED=false
//   (no active profile)                    -> SPRING_PROFILES_ACTIVE=contract (none of dev/prod)
//   JVM zone in prod                       -> TZ=America/Argentina/Buenos_Aires
// The ITs' MockMvc has no context path; black-box requests go to /api like production.

export const TEST_JWT_SECRET = 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch';
export const TEST_SYNC_KEY = 'test-sync-key';
export const TEST_ISSUER = 'https://ceitba.org.ar/api';

export const CONTRACT_ENV: Record<string, string> = {
  SPRING_PROFILES_ACTIVE: 'contract',
  TZ: 'America/Argentina/Buenos_Aires',
  AUTH_JWT_SECRET: TEST_JWT_SECRET,
  AUTH_JWT_TTL_DAYS: '1',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/callback',
  AUTH_ALLOWED_DOMAINS: 'itba.edu.ar',
  AUTH_ALLOWED_EMAILS: 'external@gmail.com',
  AUTH_SYNC_API_KEY: TEST_SYNC_KEY,
  ITBA_API_USE_FAKE: 'true',
  SPRING_FLYWAY_ENABLED: 'false',
  RATE_LIMIT_ENABLED: 'false',
  KB_LLM_USE_FAKE: 'true',
  KB_EMBEDDING_USE_FAKE: 'true',
  KB_EMBEDDINGS_ENABLED: 'false',
  KB_PIPELINE_BACKGROUND: 'false',
  MAIL_LOG_SENDS: 'true',
  DIGEST_JOBS_ENABLED: 'false',
  DIGEST_SEND_INTERVAL: 'PT0S',
  EVENT_REMINDERS_ENABLED: 'false',
  ORG_MAIL_JOBS_ENABLED: 'false',
  // Quieter logs.
  LOGGING_LEVEL_ROOT: 'WARN',
  LOGGING_LEVEL_ORG_CEITBA_API: 'WARN',
  LOG_LEVEL: 'warn',
};
