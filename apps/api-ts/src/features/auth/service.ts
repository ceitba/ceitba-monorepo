// service/auth/*: UserMeService, ApiKeyService, RefreshTokenService,
// TokenSessionService, GoogleLoginService, ReviewLoginService, DevLoginService,
// OAuthStateService.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import { ceitbaStaff } from '../../db/schema/identity';
import type { IdTokenClaims } from '../../external/google';
import { admits, isReviewEmail, sessionAdmits } from '../../http/auth/allowlist';
import { normalizeScopes, parseScopes, scopeFromKey, scopeKeys, serializeScopes, sha256Hex } from '../../http/auth/apikeys';
import { issueJwt, webTtlMs, type IssuedToken } from '../../http/auth/jwt';
import { keyIsFullPower, type ApiKeyScope, type ValidatedKey } from '../../http/auth/principal';
import { findOrCreateUser } from '../../http/auth/provisioning';
import {
  activeApiKeysOf, deleteApiKey, findUserById, followsOf, insertApiKey, isActiveModerator, isActiveStaff, membershipsOf, type UserRow,
} from '../../http/auth/repo';
import {
  InsufficientScopeError, InvalidCredentialsError, InvalidTokenError, LoginRejectedError, ReviewAccountRestrictedError,
  ReviewLoginDisabledError, ValidationError,
} from '../../http/errors';
import { effectiveCapabilities } from '../../shared/capabilities';
import { formatInstant, formatOffsetDateTime, parsePgTimestamp, systemNowMicros, toPgTimestamp, type Micros } from '../../lib/time';
import type { ApiKeyCreatedResponse, ApiKeyResponse, TokenResponse, UserMeResponse } from './dto';
import * as refreshRepo from './repo';

/** The caller's credential as UserMeService / ApiKeyService see it. */
export interface Caller {
  apiKey: ValidatedKey | null;
}

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

export class AuthService {
  private readonly dummyHash: string | null;

  constructor(private readonly deps: Deps) {
    const rl = deps.config.auth.reviewLogin;
    const log = deps.log.child({ component: 'ReviewLoginService' });
    if (rl.status === 'ENABLED') {
      this.dummyHash = bcrypt.hashSync(randomBytes(32).toString('base64'), rl.bcryptCost);
      log.warn(`Review login: ENABLED for ${rl.email}. Unset REVIEW_LOGIN_EMAIL / REVIEW_LOGIN_PASSWORD_HASH when the app is not under store review.`);
    } else if (rl.status === 'MISCONFIGURED') {
      this.dummyHash = null;
      log.error(`Review login: MISCONFIGURED, running with it DISABLED (POST /v1/auth/review-login -> 404). ${misconfiguration(rl)}`);
    } else {
      this.dummyHash = null;
      log.info('Review login: disabled');
    }
    if (deps.config.auth.devLoginEnabled) {
      deps.log.warn('DEV LOGIN ENABLED: POST /v1/auth/dev-login signs in as any allowlisted email. Never in prod.');
    }
  }

  private get auth() {
    return this.deps.config.auth;
  }

  // ------------------------------------------------------------- UserMeService

  async describe(user: UserRow, caller: Caller): Promise<UserMeResponse> {
    const { db, clock } = this.deps;
    const withheld = caller.apiKey !== null && !caller.apiKey.scopes.has('staff');
    const now = clock.now();
    const isStaff = !withheld && (await isActiveStaff(db, user.id, now));
    // isStaff || StaffPowers.isModerator (moderator grant or staff).
    const moderator = isStaff || (!withheld && (await this.isModerator(user.id, now)));
    const orgs = (await membershipsOf(db, user.id)).map((m) => ({ slug: m.organization, role: m.role }));
    const follows = (await followsOf(db, user.id)).map((f) => f.organization);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: isStaff ? 'staff' : 'user',
      moderator,
      avatarUrl: user.avatarUrl,
      theme: user.theme,
      language: user.preferredLanguage,
      careerId: user.careerId,
      plan: user.plan,
      fileNumber: user.fileNumber,
      linkedin: user.linkedin,
      instagram: user.instagram,
      discord: user.discord,
      organizations: orgs,
      follows,
      capabilities: await effectiveCapabilities(db, user, now),
      apiKeyScopes: caller.apiKey ? scopeKeys(caller.apiKey.scopes) : null,
    };
  }

  private async isModerator(userId: string, now: Micros): Promise<boolean> {
    return (await isActiveModerator(this.deps.db, userId)) || (await isActiveStaff(this.deps.db, userId, now));
  }

  // -------------------------------------------------------------- ApiKeyService

  async createApiKey(user: UserRow, caller: Caller, name: string, ttlDays: number | null, scopeKeysIn: (string | null)[] | null): Promise<ApiKeyCreatedResponse> {
    if (caller.apiKey && !keyIsFullPower(caller.apiKey)) throw new InsufficientScopeError('Scoped API keys cannot create API keys');
    if (isReviewEmail(this.auth, user.email)) throw new ReviewAccountRestrictedError('The review account cannot create API keys');
    let scopes: Set<ApiKeyScope>;
    if (scopeKeysIn === null) scopes = normalizeScopes(null);
    else {
      const parsed: ApiKeyScope[] = [];
      for (const k of scopeKeysIn) {
        const s = scopeFromKey(k ?? '');
        if (!s) throw new ValidationError('scopes', k, 'must be one of read, report, write, staff, keys');
        parsed.push(s);
      }
      scopes = normalizeScopes(parsed);
    }
    const days = ttlDays !== null && ttlDays > 0 ? ttlDays : 365;
    const rawKey = `ceitba_${b64url(randomBytes(32))}`;
    // OffsetDateTime.now() / @CreationTimestamp: system time, not the Clock.
    const now = systemNowMicros();
    // OffsetDateTime.now().plusDays(days): calendar days in the JVM zone.
    const expiresAt = plusDays(now, days);
    const id = crypto.randomUUID();
    await withTx(this.deps.db, (tx) => insertApiKey(tx, {
      id, userId: user.id, name, keyHash: sha256Hex(rawKey), expiresAt, scopes: serializeScopes(scopes), createdAt: now,
    }));
    return { id, name, key: rawKey, expiresAt: formatOffsetDateTime(expiresAt, this.deps.config.server.timeZone), scopes: scopeKeys(scopes) };
  }

  async listApiKeys(user: UserRow): Promise<ApiKeyResponse[]> {
    const rows = await activeApiKeysOf(this.deps.db, user.id, systemNowMicros());
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: formatOffsetDateTime(parsePgTimestamp(k.createdAt)),
      expiresAt: formatOffsetDateTime(parsePgTimestamp(k.expiresAt)),
      lastUsedAt: k.lastUsedAt === null ? null : formatOffsetDateTime(parsePgTimestamp(k.lastUsedAt)),
      scopes: scopeKeys(parseScopes(k.scopes)),
    }));
  }

  /** A key that isn't full power may only revoke itself. */
  async revokeApiKey(user: UserRow, caller: Caller, keyId: string): Promise<boolean> {
    if (caller.apiKey && !keyIsFullPower(caller.apiKey) && keyId !== caller.apiKey.keyId) {
      throw new InsufficientScopeError('Scoped API keys can only revoke themselves');
    }
    return (await withTx(this.deps.db, (tx) => deleteApiKey(tx, keyId, user.id))) > 0;
  }

  // ------------------------------------------------------- GoogleLoginService

  /** The gate shared by the web callback and the mobile exchange. */
  async admit(claims: IdTokenClaims): Promise<UserRow> {
    if (!claims.emailVerified) throw new LoginRejectedError('UNVERIFIED_EMAIL');
    if (!admits(this.auth, claims.email)) throw new LoginRejectedError('NOT_ALLOWLISTED');
    if (claims.hd !== null && !admits(this.auth, `anyone@${claims.hd}`)) throw new LoginRejectedError('WORKSPACE_NOT_ALLOWED');
    return findOrCreateUser(this.deps.db, this.deps.log, systemNowMicros(), claims.email!, claims.name, claims.sub, claims.picture);
  }

  // ------------------------------------------------------------- JwtIssuerService

  issueWebToken(user: UserRow): Promise<string> {
    return issueJwt(this.auth, user, webTtlMs(this.auth), systemNowMicros()).then((t) => t.token);
  }

  issueMobileAccess(user: { id: string; email: string; name: string | null }): Promise<IssuedToken> {
    return issueJwt(this.auth, user, this.auth.jwt.mobileAccessTtlMs, systemNowMicros());
  }

  // -------------------------------------------------------- TokenSessionService

  async loginWithGoogle(idToken: string, nonce: string | null, deviceName: string | null): Promise<TokenResponse> {
    const claims = await this.deps.google.idTokens.verify(idToken, nonce);
    const user = await this.admit(claims);
    const refresh = await this.issueNewFamily(user.id, deviceName);
    return this.respond(user, refresh);
  }

  async loginWithReviewCredentials(email: string | null, password: string | null, deviceName: string | null): Promise<TokenResponse> {
    const user = await this.authenticateReview(email, password);
    const refresh = await this.issueNewFamily(user.id, deviceName);
    return this.respond(user, refresh);
  }

  async refresh(rawToken: string): Promise<TokenResponse> {
    const r = await this.rotate(rawToken);
    return this.respond(r.user, r.refresh);
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken !== null && refreshToken.trim() !== '') await this.revokeFamilyOf(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await withTx(this.deps.db, async (tx) => {
      for (const f of await refreshRepo.findLiveFamilyIds(tx, userId)) await refreshRepo.lockFamily(tx, f);
      await refreshRepo.revokeAllForUser(tx, userId, this.deps.clock.now());
    });
  }

  private async respond(user: UserRow, refresh: { token: string; expiresAtMicros: Micros }): Promise<TokenResponse> {
    const access = await this.issueMobileAccess(user);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: formatInstant(access.expiresAtMicros),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: formatInstant(refresh.expiresAtMicros),
      user: await this.describe(user, { apiKey: null }),
    };
  }

  // ------------------------------------------------------- RefreshTokenService

  async issueNewFamily(userId: string, deviceName: string | null): Promise<{ token: string; expiresAtMicros: Micros }> {
    return withTx(this.deps.db, (tx) => this.issue(tx, userId, crypto.randomUUID(), deviceName, this.deps.clock.now()).then((c) => c.issued));
  }

  private async issue(tx: Tx, userId: string, familyId: string, deviceName: string | null, now: Micros) {
    const raw = b64url(randomBytes(32));
    const expiresAt = now + this.auth.jwt.refreshTtlMs * 1000;
    const id = crypto.randomUUID();
    await refreshRepo.insertRefreshToken(tx, { id, userId, familyId, tokenHash: sha256Hex(raw), deviceName: truncateDevice(deviceName), expiresAt, createdAt: now });
    return { id, issued: { token: raw, expiresAtMicros: expiresAt } };
  }

  /**
   * Rotation with reuse detection and the lost-response grace window. Family
   * revocations must survive the error that follows them (noRollbackFor), so
   * the transaction returns the error and it is thrown after commit.
   */
  /** `outer`: run inside a caller's transaction (tests hold one open, like RefreshTokenIT). */
  async rotate(rawToken: string, outer?: Tx): Promise<{ user: UserRow; refresh: { token: string; expiresAtMicros: Micros } }> {
    const INVALID = 'Refresh token is invalid or expired';
    const log = this.deps.log.child({ component: 'RefreshTokenService' });
    const outcome = await withTx(outer ?? this.deps.db, async (tx) => {
      const hash = rawToken == null ? '' : sha256Hex(rawToken);
      const familyId = await refreshRepo.findFamilyIdByTokenHash(tx, hash);
      if (!familyId) return { error: new InvalidTokenError(INVALID) } as const;
      await refreshRepo.lockFamily(tx, familyId);
      const current = await refreshRepo.findByTokenHashForUpdate(tx, hash);
      if (!current) return { error: new InvalidTokenError(INVALID) } as const;
      const now = this.deps.clock.now();
      let unusedSuccessor: refreshRepo.RefreshTokenRow | null = null;
      if (current.revokedAt !== null) {
        if (current.replacedBy === null) return { error: new InvalidTokenError(INVALID) } as const; // logged out
        const grace = this.auth.jwt.refreshReuseGraceMs * 1000;
        if (grace > 0 && !(parsePgTimestamp(current.revokedAt) + grace < now)) {
          const s = await refreshRepo.findByIdForUpdate(tx, current.replacedBy);
          if (s && s.revokedAt === null && parsePgTimestamp(s.expiresAt) > now) unusedSuccessor = s;
        }
        if (!unusedSuccessor) {
          log.warn(`Refresh token reuse detected for user ${current.userId} (family ${current.familyId}); revoking family`);
          await refreshRepo.revokeFamily(tx, current.familyId, now);
          return { error: new InvalidTokenError(INVALID) } as const;
        }
      }
      if (!(parsePgTimestamp(current.expiresAt) > now)) return { error: new InvalidTokenError(INVALID) } as const;
      const user = await findUserById(tx, current.userId);
      if (!user) return { error: new InvalidTokenError(INVALID) } as const;
      if (!sessionAdmits(this.auth, user.email)) {
        await refreshRepo.revokeFamily(tx, current.familyId, now);
        return { error: new LoginRejectedError('NOT_ALLOWLISTED') } as const;
      }
      const next = await this.issue(tx, user.id, current.familyId, current.deviceName, now);
      if (unusedSuccessor) {
        log.info(`Refresh token retried within grace window for user ${current.userId} (family ${current.familyId}); replacing unused successor`);
        await refreshRepo.setRotation(tx, unusedSuccessor.id, { revokedAt: now, replacedBy: next.id });
        await refreshRepo.setRotation(tx, current.id, { replacedBy: next.id });
      } else {
        await refreshRepo.setRotation(tx, current.id, { revokedAt: now, replacedBy: next.id });
      }
      return { user, refresh: next.issued } as const;
    });
    if ('error' in outcome) throw outcome.error;
    return outcome;
  }

  /** Logout: revokes the token's family; unknown tokens are ignored. */
  async revokeFamilyOf(rawToken: string): Promise<void> {
    await withTx(this.deps.db, async (tx) => {
      const familyId = await refreshRepo.findFamilyIdByTokenHash(tx, sha256Hex(rawToken));
      if (!familyId) return;
      await refreshRepo.lockFamily(tx, familyId);
      await refreshRepo.revokeFamily(tx, familyId, this.deps.clock.now());
    });
  }

  // -------------------------------------------------------- ReviewLoginService

  private async authenticateReview(email: string | null, password: string | null): Promise<UserRow> {
    const rl = this.auth.reviewLogin;
    if (rl.status !== 'ENABLED') throw new ReviewLoginDisabledError();
    const sha = (s: string) => Buffer.from(sha256Hex(s), 'hex');
    const emailOk = email !== null && timingSafeEqual(sha(rl.email!), sha(email.trim().toLowerCase()));
    const passwordUsable = password !== null && Buffer.byteLength(password, 'utf8') <= 72;
    // Always exactly one bcrypt check, whatever the input.
    const passwordOk = bcrypt.compareSync(passwordUsable ? password! : '', emailOk ? rl.passwordHash! : this.dummyHash!);
    const log = this.deps.log.child({ component: 'ReviewLoginService' });
    if (!(emailOk && passwordUsable && passwordOk)) {
      log.info('Review login rejected');
      throw new InvalidCredentialsError();
    }
    log.info('Review account signed in');
    return findOrCreateUser(this.deps.db, this.deps.log, systemNowMicros(), rl.email!, 'App Review', null, null);
  }

  // ---------------------------------------------------------- DevLoginService

  async devLogin(email: string | null, name: string | null, asStaff: boolean): Promise<string> {
    const normalized = email == null ? '' : email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new ValidationError('email', email, 'must be an email address');
    if (!sessionAdmits(this.auth, normalized)) {
      throw new ValidationError('email', email, 'not in AUTH_ALLOWED_DOMAINS / AUTH_ALLOWED_EMAILS');
    }
    const now = this.deps.clock.now();
    const user = await findOrCreateUser(this.deps.db, this.deps.log, now, normalized,
      name == null || name.trim() === '' ? normalized : name.trim(), null, null);
    if (asStaff && !(await isActiveStaff(this.deps.db, user.id, now))) {
      await withTx(this.deps.db, async (tx) => {
        await tx.delete(ceitbaStaff).where(eq(ceitbaStaff.userId, user.id));
        await tx.insert(ceitbaStaff).values({
          userId: user.id, branch: 'IT', role: 'MEMBER',
          start: toPgTimestamp(now - 60_000_000), end: '9999-12-31T23:59:59Z',
        });
      });
    }
    this.deps.log.info(`Dev login as ${normalized} (staff=${asStaff})`);
    return this.issueWebToken(user);
  }

  // ---------------------------------------------------------- OAuthStateService

  issueOAuthState(target: string): { state: string; nonce: string } {
    const nonce = b64url(randomBytes(16));
    const exp = Math.floor(this.deps.clock.now() / 1_000_000) + OAUTH_STATE_TTL_SECONDS;
    const payload = `${nonce}|${exp}|${target}`;
    return { state: `${b64url(Buffer.from(payload, 'utf8'))}.${b64url(this.signState(payload))}`, nonce };
  }

  /** The redirect target when the state is authentic, unexpired and bound to the cookie nonce. */
  verifyOAuthState(state: string | null, cookieNonce: string | null): string | null {
    if (state == null || cookieNonce == null || cookieNonce.trim() === '') return null;
    const dot = state.indexOf('.');
    if (dot <= 0 || dot === state.length - 1) return null;
    const a = state.slice(0, dot);
    const b = state.slice(dot + 1);
    if (!B64URL.test(a) || !B64URL.test(b)) return null;
    const payload = Buffer.from(a, 'base64url').toString('utf8');
    const sig = Buffer.from(b, 'base64url');
    const expected = this.signState(payload);
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const parts = splitLimit(payload, '|', 3);
    if (parts.length !== 3) return null;
    const nonce = Buffer.from(parts[0]!, 'utf8');
    const cookie = Buffer.from(cookieNonce, 'utf8');
    if (nonce.length !== cookie.length || !timingSafeEqual(nonce, cookie)) return null;
    if (!/^[+-]?\d+$/.test(parts[1]!)) return null;
    if (Math.floor(this.deps.clock.now() / 1_000_000) > Number(parts[1])) return null;
    return parts[2]!;
  }

  private signState(payload: string): Buffer {
    return createHmac('sha256', Buffer.from(this.auth.jwt.secretBytes)).update(`ceitba-oauth-state:${payload}`, 'utf8').digest();
  }
}

export const OAUTH_STATE_TTL_SECONDS = 600;
const B64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/** Java String.split(regex, limit) for a literal one-char separator. */
function splitLimit(s: string, sep: string, limit: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (out.length < limit - 1) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + 1);
  }
  out.push(rest);
  return out;
}

function truncateDevice(deviceName: string | null): string | null {
  if (deviceName == null || deviceName.trim() === '') return null;
  const t = deviceName.trim();
  return t.length > 120 ? t.slice(0, 120) : t;
}

/** OffsetDateTime.plusDays: the offset is kept, so it is exactly `days` x 24 h later. */
function plusDays(now: Micros, days: number): Micros {
  return now + days * 86_400_000_000;
}

function misconfiguration(rl: { email?: string; passwordHash?: string }): string {
  if (rl.email === undefined) return 'REVIEW_LOGIN_PASSWORD_HASH is set but REVIEW_LOGIN_EMAIL is empty: set both, or neither.';
  if (rl.passwordHash === undefined) {
    return 'REVIEW_LOGIN_EMAIL is set but REVIEW_LOGIN_PASSWORD_HASH is empty (if it is set in .env, '
      + 'docker compose probably expanded its `$` parts to nothing): set both, or neither.';
  }
  return 'REVIEW_LOGIN_PASSWORD_HASH is not a well-formed bcrypt hash (expected 60 chars like '
    + `$2a$12$<53 chars>, got ${rl.passwordHash.length} chars). Likely cause: in .env it `
    + "must be wrapped in SINGLE quotes (REVIEW_LOGIN_PASSWORD_HASH='$2a$12$...'), otherwise docker "
    + 'compose interpolates its `$...` parts as variables; also check for trailing characters '
    + '(e.g. a `%` pasted from a zsh prompt). Verify with (must print 1): '
    + "docker compose config | grep -cE 'REVIEW_LOGIN_PASSWORD_HASH: \\$\\$2[aby]\\$\\$[0-9]{2}\\$\\$[./A-Za-z0-9]{53}$'";
}
