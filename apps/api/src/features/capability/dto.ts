// web/capability/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

/** UpdateCapabilityRequest(@NotNull Boolean enabledForAll). */
export const UpdateCapabilityRequest = jv.object({
  enabledForAll: jv.bool({ notNull: true }),
});
export type UpdateCapabilityRequest = NonNullable<z.output<typeof UpdateCapabilityRequest>>;

/** GrantUsersRequest(@NotEmpty @Size(max = 500) List<String> emails). */
export const GrantUsersRequest = jv.object({
  emails: jv.list(jv.string(), { notEmpty: true, size: { max: 500 } }),
});
export type GrantUsersRequest = NonNullable<z.output<typeof GrantUsersRequest>>;

/** CapabilityResponse(key, label, description, enabledForAll, userGrantCount, orgGrantCount). */
export interface CapabilityResponse {
  key: string;
  label: string;
  description: string;
  enabledForAll: boolean;
  userGrantCount: number;
  orgGrantCount: number;
}

/** CapabilityGrantsResponse(users, orgs). */
export interface CapabilityGrantsResponse {
  users: { email: string; userId: string | null; name: string | null; grantedAt: string; grantedByName: string | null }[];
  orgs: { slug: string; name: string | null; memberCount: number; grantedAt: string; grantedByName: string | null }[];
}

/** PublicCapabilitiesResponse(enabledForAll). */
export interface PublicCapabilitiesResponse {
  enabledForAll: string[];
}
