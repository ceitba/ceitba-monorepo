import type { JWTPayload } from 'jose';
import type { UserRow } from './repo';

export type Role = 'USER' | 'STAFF' | 'MODERATOR' | 'ORG_MEMBER' | 'SYNC';

export type ApiKeyScope = 'read' | 'report' | 'events' | 'write' | 'staff' | 'keys';
/** EnumSet order of ApiKeyScope (READ, REPORT, EVENTS, WRITE, STAFF, KEYS): the API lists scopes in this order. */
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['read', 'report', 'events', 'write', 'staff', 'keys'];

/** ApiKeyService.ValidatedKey: a validated X-Api-Key (ceitba_*). */
export interface ValidatedKey {
  keyId: string;
  user: UserRow;
  scopes: Set<ApiKeyScope>;
}

export const keyHas = (k: ValidatedKey, s: ApiKeyScope) => k.scopes.has(s);
export const keyIsFullPower = (k: ValidatedKey) => API_KEY_SCOPES.every((s) => k.scopes.has(s));

/**
 * Who the request is (Spring's Authentication):
 *   anonymous - no credentials (AnonymousAuthenticationToken);
 *   jwt       - our HS256 JWT (bearer header or session cookie): JwtAuthenticationToken;
 *   apiKey    - a user API key (ApiKeyFilter): principal = the User row;
 *   sync      - the static AUTH_SYNC_API_KEY: ROLE_SYNC, no user.
 */
export type Principal =
  | { kind: 'anonymous' }
  | { kind: 'jwt'; token: string; claims: JWTPayload & { email?: unknown; name?: unknown }; email: string | null; roles: Set<Role> }
  | { kind: 'apiKey'; key: ValidatedKey; roles: Set<Role> }
  | { kind: 'sync'; roles: Set<Role> };

export function hasRole(p: Principal, role: Role): boolean {
  return p.kind !== 'anonymous' && p.roles.has(role);
}
