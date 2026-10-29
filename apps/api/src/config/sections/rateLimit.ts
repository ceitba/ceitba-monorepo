import { z } from 'zod';
import type { Env } from '../env';
import { defineSection } from '../registry';

// rate-limit.* (application.yml + RateLimitProperties). Rules are matched in
// declaration order against the path inside the /api context; first match wins.

const rule = z.object({
  name: z.string(),
  paths: z.array(z.string()),
  excludePaths: z.array(z.string()),
  /** Upper-cased; empty = any method. */
  methods: z.array(z.string()),
  capacity: z.number().int().positive(),
  periodMs: z.number().positive(),
});
const userRule = z.object({ capacity: z.number().int().positive(), periodMs: z.number().positive() });

const schema = z.object({
  enabled: z.boolean(),
  trustForwardedFor: z.boolean(),
  maxTrackedClients: z.number().int().positive(),
  rules: z.array(rule),
  /** Per authenticated user (service/ratelimit/UserRateLimiter), keyed by rule name. */
  userRules: z.record(z.string(), userRule),
});

export type RateLimitConfig = z.infer<typeof schema>;
export type RateLimitRule = z.infer<typeof rule>;

declare module '../registry' {
  interface ConfigSections { rateLimit: RateLimitConfig }
}

function r(env: Env, name: string, paths: string[], cap: [string, number], period: [string, string],
           opts: { exclude?: string[]; methods?: string[] } = {}): RateLimitRule {
  return {
    name, paths, excludePaths: opts.exclude ?? [], methods: (opts.methods ?? []).map((m) => m.trim().toUpperCase()),
    capacity: env.int(cap[0], cap[1]), periodMs: env.duration(period[0], period[1]),
  };
}

export default defineSection('rateLimit', schema, ({ env }) => ({
  enabled: env.bool('RATE_LIMIT_ENABLED', true),
  trustForwardedFor: env.bool('RATE_LIMIT_TRUST_FORWARDED_FOR', true),
  maxTrackedClients: 100_000,
  rules: [
    r(env, 'auth', ['/v1/auth/**'], ['RATE_LIMIT_AUTH_CAPACITY', 20], ['RATE_LIMIT_AUTH_PERIOD', '1m'], {
      exclude: ['/v1/auth/me', '/v1/auth/api-keys', '/v1/auth/api-keys/**', '/v1/auth/refresh',
        '/v1/auth/google/mobile', '/v1/auth/review-login'],
    }),
    r(env, 'auth-mobile-login', ['/v1/auth/google/mobile'], ['RATE_LIMIT_MOBILE_LOGIN_CAPACITY', 120], ['RATE_LIMIT_MOBILE_LOGIN_PERIOD', '1m']),
    r(env, 'auth-review-login', ['/v1/auth/review-login'], ['RATE_LIMIT_REVIEW_LOGIN_CAPACITY', 10], ['RATE_LIMIT_REVIEW_LOGIN_PERIOD', '1m']),
    r(env, 'auth-refresh', ['/v1/auth/refresh'], ['RATE_LIMIT_REFRESH_CAPACITY', 120], ['RATE_LIMIT_REFRESH_PERIOD', '1m']),
    r(env, 'votes', ['/v1/articles/*/votes'], ['RATE_LIMIT_VOTES_CAPACITY', 60], ['RATE_LIMIT_VOTES_PERIOD', '1m'], { methods: ['POST', 'DELETE'] }),
    r(env, 'schedule-corrections', ['/v1/commissions/*/schedule-corrections'], ['RATE_LIMIT_SCHEDULE_CORRECTIONS_CAPACITY', 10], ['RATE_LIMIT_SCHEDULE_CORRECTIONS_PERIOD', '1h'], { methods: ['POST'] }),
    r(env, 'schedule-correction-votes', ['/v1/schedule-corrections/*/vote'], ['RATE_LIMIT_VOTES_CAPACITY', 60], ['RATE_LIMIT_VOTES_PERIOD', '1m'], { methods: ['PUT', 'DELETE'] }),
    r(env, 'digest-unsubscribe', ['/v1/digests/unsubscribe'], ['RATE_LIMIT_DIGEST_UNSUBSCRIBE_CAPACITY', 60], ['RATE_LIMIT_DIGEST_UNSUBSCRIBE_PERIOD', '1m'], { methods: ['POST'] }),
    r(env, 'digest-correction-vote', ['/v1/digests/correction-vote'], ['RATE_LIMIT_DIGEST_CORRECTION_VOTE_CAPACITY', 60], ['RATE_LIMIT_DIGEST_CORRECTION_VOTE_PERIOD', '1m'], { methods: ['GET', 'POST'] }),
    r(env, 'event-rsvp', ['/v1/news/events/*/rsvp'], ['RATE_LIMIT_VOTES_CAPACITY', 60], ['RATE_LIMIT_VOTES_PERIOD', '1m'], { methods: ['POST', 'DELETE'] }),
    r(env, 'subject-review-votes', ['/v1/subject-reviews/*/helpful', '/v1/subject-reviews/*/report'], ['RATE_LIMIT_VOTES_CAPACITY', 60], ['RATE_LIMIT_VOTES_PERIOD', '1m'], { methods: ['PUT', 'DELETE'] }),
    r(env, 'org-mail-unsubscribe', ['/v1/org-mail/unsubscribe'], ['RATE_LIMIT_DIGEST_UNSUBSCRIBE_CAPACITY', 60], ['RATE_LIMIT_DIGEST_UNSUBSCRIBE_PERIOD', '1m'], { methods: ['POST'] }),
    r(env, 'analytics', ['/v1/analytics/events'], ['RATE_LIMIT_ANALYTICS_CAPACITY', 120], ['RATE_LIMIT_ANALYTICS_PERIOD', '1m'], { methods: ['POST'] }),
  ],
  userRules: {
    'org-images': { capacity: env.int('RATE_LIMIT_ORG_IMAGES_CAPACITY', 60), periodMs: env.duration('RATE_LIMIT_ORG_IMAGES_PERIOD', '1h') },
    'wiki-search': { capacity: env.int('RATE_LIMIT_WIKI_SEARCH_CAPACITY', 120), periodMs: env.duration('RATE_LIMIT_WIKI_SEARCH_PERIOD', '1h') },
    'proposal-attachments': { capacity: env.int('RATE_LIMIT_PROPOSAL_ATTACHMENTS_CAPACITY', 30), periodMs: env.duration('RATE_LIMIT_PROPOSAL_ATTACHMENTS_PERIOD', '1h') },
    'event-create': { capacity: env.int('RATE_LIMIT_EVENT_CREATE_CAPACITY', 30), periodMs: env.duration('RATE_LIMIT_EVENT_CREATE_PERIOD', '1h') },
    proposals: { capacity: env.int('RATE_LIMIT_PROPOSALS_CAPACITY', 10), periodMs: env.duration('RATE_LIMIT_PROPOSALS_PERIOD', '1h') },
    'proposal-comments': { capacity: env.int('RATE_LIMIT_PROPOSAL_COMMENTS_CAPACITY', 30), periodMs: env.duration('RATE_LIMIT_PROPOSAL_COMMENTS_PERIOD', '10m') },
    'subject-reviews': { capacity: env.int('RATE_LIMIT_SUBJECT_REVIEWS_CAPACITY', 20), periodMs: env.duration('RATE_LIMIT_SUBJECT_REVIEWS_PERIOD', '1h') },
    'professor-lookups': { capacity: env.int('RATE_LIMIT_PROFESSOR_LOOKUPS_CAPACITY', 30), periodMs: env.duration('RATE_LIMIT_PROFESSOR_LOOKUPS_PERIOD', '1h') },
    'article-comments': { capacity: env.int('RATE_LIMIT_ARTICLE_COMMENTS_CAPACITY', 20), periodMs: env.duration('RATE_LIMIT_ARTICLE_COMMENTS_PERIOD', '10m') },
    'article-comment-reports': { capacity: env.int('RATE_LIMIT_ARTICLE_COMMENT_REPORTS_CAPACITY', 30), periodMs: env.duration('RATE_LIMIT_ARTICLE_COMMENT_REPORTS_PERIOD', '10m') },
    'article-reactions': { capacity: env.int('RATE_LIMIT_ARTICLE_REACTIONS_CAPACITY', 120), periodMs: env.duration('RATE_LIMIT_ARTICLE_REACTIONS_PERIOD', '10m') },
  },
}));
