// The staff/CMS request DTOs whose URL fields the public site renders as links
// or images (apps/api/src/main/java/org/ceitba/api/web/staff/dto/
// {Create,Update}StaffMemberRequest, {Create,Update}BenefitCardRequest,
// UpdateBenefitRequest): absolute http(s) URL or blank, so a javascript: or
// data: link never reaches a visitor's browser. All constraints of each
// record are ported, with Hibernate's messages (src/lib/beanConstraints.ts).

import { z } from 'zod';
import { constraints, email, min, notBlank, pattern, size } from '../../../lib/beanConstraints';
import { jv } from '../../../http/validation';

/** @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL"), Java's ASCII \s. */
export const HTTP_URL_REGEXP = '^(\\s*|https?://\\S+)$';
const HTTP_URL = /^(?:[ \t\n\x0B\f\r]*|https?:\/\/[^ \t\n\x0B\f\r]+)$/;
const urlField = () => jv.string().superRefine(constraints(size({ max: 2048 }),
  pattern(HTTP_URL, HTTP_URL_REGEXP, 'must be an http(s) URL')));
const required = () => jv.string().superRefine(constraints(notBlank()));
const text = () => jv.string();
const strings = () => jv.list(jv.string());

const staffMember = {
  year: jv.int({ primitive: true }).superRefine(constraints(min(2000))),
  departmentSlug: required(),
  displayOrder: jv.int({ primitive: true }),
  name: required(),
  roleEs: required(),
  roleEn: required(),
  photoUrl: urlField(),
  linkedinUrl: urlField(),
  email: text(),
};
export const CreateStaffMemberRequest = jv.object(staffMember);
export const UpdateStaffMemberRequest = jv.object(staffMember);

const benefitCard = {
  categorySlug: required(),
  displayOrder: jv.int({ primitive: true }),
  titleEs: required(),
  titleEn: required(),
  summaryEs: text(),
  summaryEn: text(),
  imageUrl: urlField(),
  ctaUrl: urlField(),
  ctaLabelEs: text(),
  ctaLabelEn: text(),
  price: text(),
  bulletsEs: strings(),
  bulletsEn: strings(),
  // Contact details (mobile app; all optional).
  location: text(),
  locationUrl: urlField(),
  phone: jv.string().superRefine(constraints(size({ max: 64 }))),
  website: urlField(),
  email: jv.string().superRefine(constraints(email(), size({ max: 255 }))),
};
export const CreateBenefitCardRequest = jv.object(benefitCard);
export const UpdateBenefitCardRequest = jv.object(benefitCard);

export const UpdateBenefitRequest = jv.object({
  colorVar: required(),
  displayOrder: jv.int({ primitive: true }),
  linkUrl: urlField(),
  contactEmail: text(),
  highlightsEs: strings(),
  highlightsEn: strings(),
  // Category display names (optional; the SPA falls back to i18n keys).
  nameEs: jv.string().superRefine(constraints(size({ max: 255 }))),
  nameEn: jv.string().superRefine(constraints(size({ max: 255 }))),
});

export type CreateStaffMemberRequest = z.output<typeof CreateStaffMemberRequest>;
export type UpdateStaffMemberRequest = z.output<typeof UpdateStaffMemberRequest>;
export type CreateBenefitCardRequest = z.output<typeof CreateBenefitCardRequest>;
export type UpdateBenefitCardRequest = z.output<typeof UpdateBenefitCardRequest>;
export type UpdateBenefitRequest = z.output<typeof UpdateBenefitRequest>;
