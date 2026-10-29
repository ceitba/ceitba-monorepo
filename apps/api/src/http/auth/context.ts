// What route handlers use to know the caller (the TS side of @CurrentUser,
// ApiKeyCredential and StaffPowers).

import type { Db } from '../../db/client';
import type { Deps } from '../../deps';
import type { AppContext } from '../context';
import { AccessDeniedError, InvalidTokenError } from '../errors';
import { findOrCreateUser } from './provisioning';
import { keyHas, type Principal, type ValidatedKey } from './principal';
import { isActiveModerator, isActiveStaff, type UserRow } from './repo';
import { stringClaim } from './jwt';
import { systemNowMicros } from '../../lib/time';

export function principal(c: AppContext): Principal {
  return c.get('state').principal;
}

/**
 * CurrentUserResolver: the caller's User row, JIT-provisioned for JWTs;
 * null for anonymous callers (public routes with an optional user); 403
 * AccessDenied for the sync key (authenticated without a user).
 */
export async function optionalUser(c: AppContext): Promise<UserRow | null> {
  const state = c.get('state');
  if (state.currentUser !== undefined) return state.currentUser;
  const p = state.principal;
  const deps = c.get('deps');
  let u: UserRow | null;
  if (p.kind === 'jwt') {
    const email = stringClaim(p.claims, 'email');
    if (email === null) throw new InvalidTokenError('Token carries no email');
    u = await findOrCreateUser(deps.db, deps.log, systemNowMicros(), email, stringClaim(p.claims, 'name'), null, null);
  } else if (p.kind === 'apiKey') {
    u = p.key.user;
  } else if (p.kind === 'anonymous') {
    u = null;
  } else {
    throw new AccessDeniedError('This endpoint requires a user session');
  }
  state.currentUser = u;
  return u;
}

/**
 * @CurrentUser on a route the URL policy already authenticated. An anonymous
 * caller here means a public route used it without handling null: Java would
 * NPE (500), so this throws.
 */
export async function currentUser(c: AppContext): Promise<UserRow> {
  const u = await optionalUser(c);
  if (!u) throw new Error('currentUser() on an anonymous request: use optionalUser() on public routes');
  return u;
}

/** ApiKeyCredential.current(): the API key the request used, if any. */
export function apiKeyCredential(c: AppContext): ValidatedKey | null {
  const p = principal(c);
  return p.kind === 'apiKey' ? p.key : null;
}

/** True when the caller uses an API key that lacks the "staff" scope. */
export function staffWithheld(c: AppContext): boolean {
  const k = apiKeyCredential(c);
  return k !== null && !keyHas(k, 'staff');
}

/**
 * service/auth/StaffPowers: whether a user holds staff / moderator powers from
 * the database, false for a request whose API key lacks "staff". Staff expiry is
 * checked against `deps.clock` (Java's injected Clock); the request's roles use
 * the system time instead (`staffRoles` in src/http/security.ts explains why).
 */
export function staffPowers(c: AppContext): StaffPowers {
  return staffPowersOf(c.get('deps'), staffWithheld(c));
}

/** StaffPowers outside a request (`withheld`: the credential lacks the `staff` scope). */
export function staffPowersOf(deps: Deps, withheld: boolean): StaffPowers {
  return {
    async isStaff(userId, db = deps.db) {
      if (!userId || withheld) return false;
      return isActiveStaff(db, userId, deps.clock.now());
    },
    async isModerator(userId, db = deps.db) {
      if (!userId || withheld) return false;
      return (await isActiveModerator(db, userId)) || (await isActiveStaff(db, userId, deps.clock.now()));
    },
  };
}

/** What staffPowers(c) answers; `db` lets a service read inside its own transaction (default: the pool). */
export interface StaffPowers {
  isStaff(userId: string | null | undefined, db?: Db): Promise<boolean>;
  /** Staff are moderators too. */
  isModerator(userId: string | null | undefined, db?: Db): Promise<boolean>;
}
