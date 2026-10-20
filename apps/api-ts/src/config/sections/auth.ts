import { z } from 'zod';
import { parseBool, parseDuration, parseIntStrict, type Env } from '../env';
import { defineSection } from '../registry';

// auth.* (application.yml + AuthProperties / ReviewLoginProperties normalization)
// and content.hmac-secret.

export const JWT_AUDIENCE = 'ceitba-api';
const BCRYPT = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./0-9A-Za-z]{53}$/;

const schema = z.object({
  allowedDomains: z.array(z.string()),
  allowedEmails: z.array(z.string()),
  syncApiKey: z.string(),
  google: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    redirectUri: z.string(),
    /** AUTH_GOOGLE_MOBILE_AUDIENCES, blanks dropped, trimmed. Empty = mobile login 501. */
    mobileAudiences: z.array(z.string()),
  }),
  jwt: z.object({
    /** Base64 AUTH_JWT_SECRET (required, >= 32 bytes decoded). */
    secret: z.string(),
    secretBytes: z.instanceof(Uint8Array),
    /** Raw auth.jwt.ttl-days (the issuer/cookie fall back to 7 when <= 0). */
    ttlDays: z.number().int(),
    issuer: z.string(),
    audience: z.literal(JWT_AUDIENCE),
    enforceIssuerAudience: z.boolean(),
    mobileAccessTtlMs: z.number().positive(),
    refreshTtlMs: z.number().positive(),
    refreshReuseGraceMs: z.number().min(0),
  }),
  cookie: z.object({
    name: z.string(),
    domain: z.string().optional(),
    secure: z.boolean(),
    sameSite: z.string(),
    path: z.string(),
  }),
  frontendUrl: z.string(),
  reviewLogin: z.object({
    /** Trimmed, lowercased; undefined when blank. */
    email: z.string().optional(),
    passwordHash: z.string().optional(),
    status: z.enum(['DISABLED', 'ENABLED', 'MISCONFIGURED']),
    /** bcrypt cost of a well-formed hash, else 10. */
    bcryptCost: z.number().int(),
  }),
  /** POST /v1/auth/dev-login exists only with the `dev` profile AND AUTH_DEV_LOGIN_ENABLED=true. */
  devLoginEnabled: z.boolean(),
  /** content.hmac-secret (CONTENT_HMAC_SECRET); empty = derive from AUTH_JWT_SECRET (service/crypto/ContentHmac). */
  contentHmacSecret: z.string(),
});

export type AuthConfig = z.infer<typeof schema>;

declare module '../registry' {
  interface ConfigSections { auth: AuthConfig }
}

// Spring binds an empty string to a Boolean/Duration/Integer as null, which the
// records then replace with their default.
function nullable<T>(env: Env, name: string, def: string, parse: (s: string, n: string) => T): T | null {
  const v = env.str(name, def);
  return v.trim() === '' ? null : parse(v, name);
}

export default defineSection('auth', schema, ({ env, hasProfile }) => {
  const secret = env.str('AUTH_JWT_SECRET', '');
  if (secret.trim() === '') {
    throw new Error('auth.jwt.secret (AUTH_JWT_SECRET) must be configured. Generate with: openssl rand -base64 32');
  }
  const secretBytes = new Uint8Array(Buffer.from(secret, 'base64'));
  if (secretBytes.length < 32) throw new Error('AUTH_JWT_SECRET must decode to at least 32 bytes (256 bits)');

  const positiveOr = (v: number | null, fallback: number) => (v === null || v <= 0 ? fallback : v);
  const grace = nullable(env, 'AUTH_REFRESH_REUSE_GRACE', '60s', parseDuration);
  const issuer = env.str('AUTH_JWT_ISSUER', 'https://ceitba.org.ar/api');
  const enforce = nullable(env, 'AUTH_JWT_ENFORCE_ISS_AUD', 'true', parseBool);

  // application-dev.yml sets auth.cookie.secure=false / same-site=Lax; an env var
  // with the property's relaxed name (AUTH_COOKIE_SECURE) still wins over it.
  const dev = hasProfile('dev');
  const secureRaw = dev && env.raw.AUTH_COOKIE_SECURE === undefined ? 'false' : env.str('AUTH_COOKIE_SECURE', 'true');
  const secure = secureRaw.trim() === '' ? true : parseBool(secureRaw, 'AUTH_COOKIE_SECURE');
  const sameSite = env.str('AUTH_COOKIE_SAMESITE', 'Lax');
  const cookieName = env.str('AUTH_COOKIE_NAME', 'ceitba_session');
  const cookiePath = env.str('AUTH_COOKIE_PATH', '/');
  const cookieDomain = env.str('AUTH_COOKIE_DOMAIN', '');

  const reviewEmail = env.str('REVIEW_LOGIN_EMAIL', '').trim();
  const reviewHash = env.str('REVIEW_LOGIN_PASSWORD_HASH', '').trim();
  const email = reviewEmail === '' ? undefined : reviewEmail.toLowerCase();
  const passwordHash = reviewHash === '' ? undefined : reviewHash;
  const status = !email && !passwordHash ? 'DISABLED'
    : !email || !passwordHash ? 'MISCONFIGURED'
      : BCRYPT.test(passwordHash) ? 'ENABLED' : 'MISCONFIGURED';
  const costMatch = passwordHash ? BCRYPT.exec(passwordHash) : null;

  return {
    allowedDomains: env.list('AUTH_ALLOWED_DOMAINS', 'itba.edu.ar'),
    allowedEmails: env.list('AUTH_ALLOWED_EMAILS', ''),
    syncApiKey: env.str('AUTH_SYNC_API_KEY', ''),
    google: {
      clientId: env.str('GOOGLE_CLIENT_ID', ''),
      clientSecret: env.str('GOOGLE_CLIENT_SECRET', ''),
      redirectUri: env.str('GOOGLE_REDIRECT_URI', 'http://localhost:8080/api/v1/auth/callback'),
      mobileAudiences: env.list('AUTH_GOOGLE_MOBILE_AUDIENCES', '').filter((a) => a.trim() !== '').map((a) => a.trim()),
    },
    jwt: {
      secret,
      secretBytes,
      ttlDays: nullable(env, 'AUTH_JWT_TTL_DAYS', '7', parseIntStrict) ?? 0,
      issuer: issuer.trim() === '' ? 'https://ceitba.org.ar/api' : issuer,
      audience: JWT_AUDIENCE,
      enforceIssuerAudience: enforce !== false,
      mobileAccessTtlMs: positiveOr(nullable(env, 'AUTH_MOBILE_ACCESS_TTL', '15m', parseDuration), 15 * 60_000),
      refreshTtlMs: positiveOr(nullable(env, 'AUTH_REFRESH_TTL', '60d', parseDuration), 60 * 86_400_000),
      refreshReuseGraceMs: grace === null ? 60_000 : Math.max(0, grace),
    },
    cookie: {
      name: cookieName.trim() === '' ? 'ceitba_session' : cookieName,
      domain: cookieDomain.trim() === '' ? undefined : cookieDomain,
      secure,
      sameSite: dev && env.raw.AUTH_COOKIE_SAMESITE === undefined ? 'Lax' : (sameSite.trim() === '' ? 'Lax' : sameSite),
      path: cookiePath.trim() === '' ? '/' : cookiePath,
    },
    frontendUrl: env.str('FRONTEND_URL', 'http://localhost:3000'),
    reviewLogin: { email, passwordHash, status, bcryptCost: costMatch ? Number(costMatch[1]) : 10 },
    devLoginEnabled: dev && env.bool('AUTH_DEV_LOGIN_ENABLED', false),
    contentHmacSecret: env.str('CONTENT_HMAC_SECRET', ''),
  };
});
