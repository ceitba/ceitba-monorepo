// web/auth/dto/*: request schemas (Bean Validation) and response shapes
// (record component order = JSON key order).

import type { z } from 'zod';
import { jv } from '../../http/validation';

export const CreateApiKeyRequest = jv.object({
  name: jv.string({ notBlank: true }),
  ttlDays: jv.int({ positive: true, max: 365 }),
  scopes: jv.list(jv.string(), { size: { max: 6 } }),
});
export type CreateApiKeyRequest = NonNullable<z.output<typeof CreateApiKeyRequest>>;

export const GoogleMobileLoginRequest = jv.object({
  idToken: jv.string({ notBlank: true, size: { max: 8192 } }),
  nonce: jv.string({ size: { max: 512 } }),
  deviceName: jv.string({ size: { max: 120 } }),
});

export const RefreshRequest = jv.object({
  refreshToken: jv.string({ notBlank: true, size: { max: 256 } }),
});

/** Bound without @Valid (TokenAuthController.reviewLogin); deviceName is cut at 120 chars. */
export const ReviewLoginRequest = jv.object({
  email: jv.string(),
  password: jv.string(),
  deviceName: jv.string(),
});

export const DevLoginRequest = jv.object({
  email: jv.string({ notBlank: true, size: { max: 320 } }),
  name: jv.string({ size: { max: 200 } }),
  staff: jv.bool({ primitive: true }),
});

export const LogoutRequest = jv.object({ refreshToken: jv.string() });

export interface MembershipDto { slug: string; role: string }

/** UserMeResponse. */
export interface UserMeResponse {
  id: string;
  name: string | null;
  email: string;
  role: 'staff' | 'user';
  moderator: boolean;
  avatarUrl: string | null;
  theme: string | null;
  language: string | null;
  careerId: string | null;
  plan: string | null;
  fileNumber: number | null;
  linkedin: string | null;
  instagram: string | null;
  discord: string | null;
  organizations: MembershipDto[];
  follows: string[];
  capabilities: string[];
  apiKeyScopes: string[] | null;
}

/** TokenResponse (Instants). */
export interface TokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserMeResponse;
}

/** ApiKeyCreatedResponse: expiresAt is OffsetDateTime.now().plusDays(..) (JVM zone). */
export interface ApiKeyCreatedResponse { id: string; name: string; key: string; expiresAt: string; scopes: string[] }

/** ApiKeyResponse: timestamps read from the DB (UTC). */
export interface ApiKeyResponse {
  id: string; name: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; scopes: string[];
}
