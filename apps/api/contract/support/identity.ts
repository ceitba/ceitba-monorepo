// Identities for black-box tests. The Java ITs fake authentication with
// MockMvc's jwt()/user() and grant ROLE_STAFF as a mock authority; here every
// identity is real: a JWT signed with the test secret exactly like
// JwtIssuerService, and real ceitba_staff / ceitba_moderators / api_keys rows.

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Sql } from 'postgres';
import { TEST_ISSUER, TEST_JWT_SECRET } from './env';

const SECRET = new Uint8Array(Buffer.from(TEST_JWT_SECRET, 'base64'));

export interface MintOptions {
  email?: string | null;
  name?: string | null;
  sub?: string;
  /** Seconds from now (default 3600). Negative = already expired. */
  ttlSeconds?: number;
  iss?: string | null;
  aud?: string | string[] | null;
  /** Extra / overriding claims. */
  claims?: Record<string, unknown>;
  /** Sign with another key (bad signature tests). */
  secret?: Uint8Array;
  alg?: 'HS256' | 'HS384' | 'HS512';
  iat?: number;
  nbf?: number;
}

/** An HS256 JWT with JwtIssuerService's claims (iss, aud, jti, sub, email, name, iat, exp). */
export async function mintJwt(o: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {};
  if (o.iss !== null) payload.iss = o.iss ?? TEST_ISSUER;
  if (o.aud !== null) payload.aud = o.aud ?? 'ceitba-api';
  payload.jti = crypto.randomUUID();
  payload.sub = o.sub ?? crypto.randomUUID();
  if (o.email !== null) payload.email = o.email ?? 'alice@itba.edu.ar';
  if (o.name !== null && o.name !== undefined) payload.name = o.name;
  const exp = now + (o.ttlSeconds ?? 3600);
  // An already-expired token keeps iat < exp (Spring rejects exp <= iat with its own message).
  payload.iat = o.iat ?? Math.min(now, exp - 3600);
  payload.exp = exp;
  if (o.nbf !== undefined) payload.nbf = o.nbf;
  Object.assign(payload, o.claims ?? {});
  const alg = o.alg ?? 'HS256';
  const key = o.secret ?? (alg === 'HS256' ? SECRET : new Uint8Array(Buffer.concat([Buffer.from(SECRET), Buffer.from(SECRET)])));
  return new SignJWT(payload).setProtectedHeader({ alg }).sign(key);
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface UserSeed {
  id?: string;
  name?: string | null;
  avatarUrl?: string | null;
  careerId?: string | null;
  plan?: string | null;
  fileNumber?: number | null;
  linkedin?: string | null;
  instagram?: string | null;
  discord?: string | null;
}

/** Inserts a user row like `userRepository.save(new User(id, email, name))` (NULL language/theme). */
export async function seedUser(db: Sql, email: string, s: UserSeed = {}): Promise<string> {
  const id = s.id ?? crypto.randomUUID();
  await db`INSERT INTO public."user" (id, email, name, avatar_url, career_id, plan, file_number, linkedin, instagram, discord,
                                      preferred_language, theme, digest_email_enabled, created_at, updated_at)
           VALUES (${id}, ${email}, ${s.name === undefined ? email : s.name}, ${s.avatarUrl ?? null}, ${s.careerId ?? null}, ${s.plan ?? null},
                   ${s.fileNumber ?? null}, ${s.linkedin ?? null}, ${s.instagram ?? null}, ${s.discord ?? null},
                   NULL, NULL, true, now(), now())`;
  return id;
}

export async function userIdByEmail(db: Sql, email: string): Promise<string | null> {
  const [r] = await db`SELECT id FROM public."user" WHERE email = ${email}`;
  return (r?.id as string) ?? null;
}

/** An active ceitba_staff row (IT, MEMBER, started yesterday, ends in 30 days); creates the user if needed. */
export async function seedStaff(db: Sql, email: string, o: { startOffsetDays?: number; endOffsetDays?: number } = {}): Promise<string> {
  const id = (await userIdByEmail(db, email)) ?? (await seedUser(db, email));
  await db`INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end")
           VALUES (${id}, 'IT', 'MEMBER', now() + make_interval(days => ${o.startOffsetDays ?? -1}), now() + make_interval(days => ${o.endOffsetDays ?? 30}))
           ON CONFLICT (user_id) DO UPDATE SET start = EXCLUDED.start, "end" = EXCLUDED."end"`;
  return id;
}

export async function seedModerator(db: Sql, userId: string): Promise<void> {
  await db`INSERT INTO public.ceitba_moderators (user_id, granted_at) VALUES (${userId}, now())
           ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL`;
}

export async function revokeModerator(db: Sql, userId: string): Promise<void> {
  await db`UPDATE public.ceitba_moderators SET revoked_at = now() WHERE user_id = ${userId}`;
}

/** ApiKeyService.create equivalent: returns {id, key}. `scopes` null = full power. */
export async function seedApiKey(db: Sql, userId: string, scopes: string[] | null = null, ttlDays = 30): Promise<{ id: string; key: string }> {
  const order = ['read', 'report', 'events', 'write', 'staff', 'keys'];
  let set: Set<string>;
  if (scopes === null) set = new Set(order);
  else {
    set = new Set(['read', ...scopes]);
    if (set.has('write')) {
      set.add('report');
      set.add('events');
    }
  }
  const csv = order.filter((s) => set.has(s) && !(s === 'events' && set.has('write'))).join(',');
  const key = `ceitba_${randomBytes(32).toString('base64url')}`;
  const id = crypto.randomUUID();
  await db`INSERT INTO public.api_keys (id, user_id, name, key_hash, created_at, expires_at, scopes)
           VALUES (${id}, ${userId}, 'test', ${sha256Hex(key)}, now(), now() + make_interval(days => ${ttlDays}), ${csv})`;
  return { id, key };
}

/** RefreshTokenService.issueNewFamily equivalent: returns the raw token. */
export async function seedRefreshToken(db: Sql, userId: string, o: { raw?: string; deviceName?: string | null; expiresInSeconds?: number; familyId?: string } = {}): Promise<string> {
  const raw = o.raw ?? randomBytes(32).toString('base64url');
  await db`INSERT INTO public.refresh_tokens (id, user_id, family_id, token_hash, device_name, created_at, expires_at)
           VALUES (${crypto.randomUUID()}, ${userId}, ${o.familyId ?? crypto.randomUUID()}, ${sha256Hex(raw)},
                   ${o.deviceName === undefined ? 'test-device' : o.deviceName}, now(), now() + make_interval(secs => ${o.expiresInSeconds ?? 60 * 86400}))`;
  return raw;
}

export async function seedCareer(db: Sql, id: string, name: string): Promise<void> {
  await db`INSERT INTO public.careers (id, name, updated_at) VALUES (${id}, ${name}, now())`;
}

export async function seedPlan(db: Sql, id: string, careerId: string, name: string | null): Promise<void> {
  await db`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES (${id}, ${careerId}, ${name}, now())`;
}

/** jdbc.execute("TRUNCATE public.\"user\" CASCADE") */
export async function truncateUsers(db: Sql): Promise<void> {
  await db`TRUNCATE public."user" CASCADE`;
}
