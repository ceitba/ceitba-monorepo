// web/staff/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

export {
  CreateBenefitCardRequest, CreateStaffMemberRequest, UpdateBenefitCardRequest, UpdateBenefitRequest, UpdateStaffMemberRequest,
} from './logic/requests';

export const BRANCHES = ['IT', 'MEDIA', 'INFRASTRUCTURE', 'NAUTICAL', 'EVENTS', 'DIRECTIVES'] as const;
export const STAFF_ROLES = ['PRESIDENT', 'VICEPRESIDENT', 'SECRETARY', 'TREASURER', 'LEADER', 'MEMBER'] as const;

/** AssignStaffRequest(@NotBlank @Email email, @NotNull branch, @NotNull role, @NotNull start, @NotNull end). */
export const AssignStaffRequest = jv.object({
  email: jv.string({ notBlank: true, email: true }),
  branch: jv.enum(BRANCHES, { notNull: true }),
  role: jv.enum(STAFF_ROLES, { notNull: true }),
  start: jv.instant({ notNull: true }),
  end: jv.instant({ notNull: true }),
});
export type AssignStaffRequest = NonNullable<z.output<typeof AssignStaffRequest>>;

/** GrantModeratorRequest(@NotBlank @Email email). */
export const GrantModeratorRequest = jv.object({
  email: jv.string({ notBlank: true, email: true }),
});
export type GrantModeratorRequest = NonNullable<z.output<typeof GrantModeratorRequest>>;

/** UpdateStaffDepartmentRequest(@NotBlank colorVar, int displayOrder). */
export const UpdateStaffDepartmentRequest = jv.object({
  colorVar: jv.string({ notBlank: true }),
  displayOrder: jv.int({ primitive: true }),
});
export type UpdateStaffDepartmentRequest = NonNullable<z.output<typeof UpdateStaffDepartmentRequest>>;

/** StaffResponse(@JsonProperty("user_id") userId, email, name, branch, role, start, end): the renamed component is written last. */
export interface StaffResponse {
  email: string;
  name: string | null;
  branch: string;
  role: string;
  start: string;
  end: string;
  user_id: string;
}

/** ModeratorResponse(userId, email, name, grantedBy, grantedAt). */
export interface ModeratorResponse {
  userId: string;
  email: string | null;
  name: string | null;
  grantedBy: string | null;
  grantedAt: string;
}

/** StaffDepartmentResponse(slug, colorVar, displayOrder). */
export interface StaffDepartmentResponse {
  slug: string;
  colorVar: string;
  displayOrder: number;
}

/** StaffMemberResponse(id, year, departmentSlug, displayOrder, name, roleEs, roleEn, photoUrl, linkedinUrl, email). */
export interface StaffMemberResponse {
  id: string;
  year: number;
  departmentSlug: string;
  displayOrder: number;
  name: string;
  roleEs: string;
  roleEn: string;
  photoUrl: string | null;
  linkedinUrl: string | null;
  email: string | null;
}

/** BenefitResponse(slug, colorVar, displayOrder, linkUrl, contactEmail, highlightsEs, highlightsEn, nameEs, nameEn). */
export interface BenefitResponse {
  slug: string;
  colorVar: string;
  displayOrder: number;
  linkUrl: string | null;
  contactEmail: string | null;
  highlightsEs: (string | null)[];
  highlightsEn: (string | null)[];
  nameEs: string | null;
  nameEn: string | null;
}

/** BenefitCardResponse (record component order). */
export interface BenefitCardResponse {
  id: string;
  categorySlug: string;
  displayOrder: number;
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
  imageUrl: string | null;
  ctaUrl: string | null;
  ctaLabelEs: string | null;
  ctaLabelEn: string | null;
  price: string | null;
  bulletsEs: string[];
  bulletsEn: string[];
  location: string | null;
  locationUrl: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
}

/** PushBroadcastRequest(@NotBlank @Size(max = 200) title, @NotBlank @Size(max = 1000) body, @Size(max = 10) Map<String, String> data). */
export const PushBroadcastRequest = jv.object({
  title: jv.string({ notBlank: true, size: { max: 200 } }),
  body: jv.string({ notBlank: true, size: { max: 1000 } }),
  data: jv.map(jv.string(), { size: { max: 10 } }),
});
export type PushBroadcastRequest = NonNullable<z.output<typeof PushBroadcastRequest>>;
