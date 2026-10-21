// web/news/dto/* and the records nested in the news controllers/services.

import type { z } from 'zod';
import { jv } from '../../http/validation';
import { isNewsCategory, NEWS_CATEGORY_MESSAGE } from './logic/newsCategories';

export type { PageResponse, PageMeta } from './paging';

// Java \s / \S are ASCII-only.
const HTTP_URL = /^(?:[ \t\n\x0B\f\r]*|https?:\/\/[^ \t\n\x0B\f\r]+)$/;
const EMAIL_ADDR = /^(?:[ \t\n\x0B\f\r]*|[^@ \t\n\x0B\f\r]+@[^@ \t\n\x0B\f\r]+\.[^@ \t\n\x0B\f\r]+)$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** @Pattern(regexp = ..., message = ...) with a literal message. */
const matches = (re: RegExp, message: string) => (v: string) => (re.test(v) ? null : message);

/** @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL") */
const httpUrl = () => jv.string({ size: { max: 2048 }, check: matches(HTTP_URL, 'must be an http(s) URL') });
/** @NotBlank @Pattern(regexp = NewsCategories.PATTERN, message = NewsCategories.MESSAGE) */
const category = (notBlank: boolean) =>
  jv.string({ notBlank, check: (v: string) => (isNewsCategory(v) ? null : NEWS_CATEGORY_MESSAGE) });

// ------------------------------------------------------------------ articles

/** ArticleInput. `featured` is a primitive boolean. */
export const ArticleInput = jv.object({
  id: jv.string(),
  title: jv.string({ notBlank: true }),
  excerpt: jv.string({ notBlank: true }),
  body: jv.list(jv.string(), { notNull: true }),
  category: category(true),
  organization: jv.string(),
  authors: jv.list(jv.string(), { notEmpty: true }),
  publishedAt: jv.localDate(),
  readingTime: jv.string(),
  featured: jv.bool({ primitive: true }),
  colorScheme: jv.string(),
  coverImage: jv.string(),
  status: jv.string(),
});
export type ArticleInput = NonNullable<z.output<typeof ArticleInput>>;

/** ArticlePatchInput: every field optional. */
export const ArticlePatchInput = jv.object({
  title: jv.string(),
  excerpt: jv.string(),
  body: jv.list(jv.string()),
  category: category(false),
  organization: jv.string(),
  authors: jv.list(jv.string()),
  publishedAt: jv.localDate(),
  readingTime: jv.string(),
  featured: jv.bool(),
  colorScheme: jv.string(),
  coverImage: jv.string(),
  status: jv.string(),
  clearPublishedAt: jv.bool(),
  expectedStatus: jv.string(),
});
export type ArticlePatchInput = NonNullable<z.output<typeof ArticlePatchInput>>;

export interface ArticleResponse {
  id: string;
  title: string;
  excerpt: string;
  body: string[];
  category: string;
  organization: string | null;
  authors: string[];
  publishedAt: string | null;
  readingTime: string | null;
  featured: boolean;
  colorScheme: string | null;
  coverImage: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

// ------------------------------------------------------------------ events

const signupMode = () => jv.string({ check: matches(/^(none|external|rsvp)$/, 'must be none, external or rsvp') });

/** NewsEventInput. */
export const NewsEventInput = jv.object({
  id: jv.string(),
  title: jv.string({ notBlank: true }),
  eventDate: jv.localDate({ notNull: true }),
  startTime: jv.localTime({ notNull: true }),
  endTime: jv.localTime({ notNull: true }),
  location: jv.string({ notBlank: true }),
  category: category(true),
  organization: jv.string(),
  description: jv.string(),
  coverImage: httpUrl(),
  onlineUrl: httpUrl(),
  signupMode: signupMode(),
  signupUrl: httpUrl(),
  capacity: jv.int({ positive: true, max: 100000 }),
});
export type NewsEventInput = NonNullable<z.output<typeof NewsEventInput>>;

/** NewsEventPatchInput. */
export const NewsEventPatchInput = jv.object({
  title: jv.string(),
  eventDate: jv.localDate(),
  startTime: jv.localTime(),
  endTime: jv.localTime(),
  location: jv.string(),
  category: category(false),
  organization: jv.string(),
  description: jv.string(),
  coverImage: httpUrl(),
  onlineUrl: httpUrl(),
  signupMode: signupMode(),
  signupUrl: httpUrl(),
  capacity: jv.int({ positive: true, max: 100000 }),
});
export type NewsEventPatchInput = NonNullable<z.output<typeof NewsEventPatchInput>>;

export interface NewsEventResponse {
  id: string;
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  category: string;
  organization: string | null;
  description: string | null;
  createdAt: string | null;
  coverImage: string | null;
  onlineUrl: string | null;
  signupMode: string;
  signupUrl: string | null;
  capacity: number | null;
  rsvpCount: number;
}

/** NewsEventController.RsvpResponse(boolean going, long rsvpCount). */
export interface RsvpResponse {
  going: boolean;
  rsvpCount: number;
}

/** EventRsvpService.Attendee. */
export interface Attendee {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ organizations

const orgProfileFields = {
  description: jv.string(),
  category: jv.string(),
  color: jv.string(),
  logoUrl: httpUrl(),
  backgroundUrl: httpUrl(),
  instagram: jv.string(),
  linkedinUrl: httpUrl(),
  websiteUrl: httpUrl(),
  contactEmail: jv.string({ size: { max: 320 }, check: matches(EMAIL_ADDR, 'must be an email address') }),
  recruitingOpen: jv.bool(),
  recruitingUrl: httpUrl(),
  recruitingText: jv.string({ size: { max: 280 } }),
};

/** OrganizationRequest (POST). */
export const OrganizationRequest = jv.object({
  slug: jv.string({
    notBlank: true,
    check: (v: string) => {
      const sizeMsg = v.length < 2 || v.length > 40 ? 'must be 2-40 characters' : null;
      const patternMsg = SLUG.test(v) ? null : 'must use only lowercase letters, digits and single hyphens between them';
      // Two violations of one field are joined by the handler; keep both like Java.
      return sizeMsg && patternMsg ? `${sizeMsg}; slug: ${patternMsg}` : (sizeMsg ?? patternMsg);
    },
  }),
  name: jv.string({ notBlank: true }),
  fullName: jv.string({ notBlank: true }),
  ...orgProfileFields,
});
export type OrganizationRequest = NonNullable<z.output<typeof OrganizationRequest>>;

/** OrganizationPatchRequest (PATCH): the slug comes from the path. */
export const OrganizationPatchRequest = jv.object({
  name: jv.string(),
  fullName: jv.string(),
  ...orgProfileFields,
});
export type OrganizationPatchRequest = NonNullable<z.output<typeof OrganizationPatchRequest>>;

/** OrganizationMembershipService.BoardMemberView. */
export interface BoardMemberView {
  name: string | null;
  title: string | null;
  avatarUrl: string | null;
}

export interface OrganizationResponse {
  slug: string;
  name: string;
  fullName: string;
  description: string | null;
  category: string | null;
  color: string | null;
  followerCount: number;
  logoUrl: string | null;
  backgroundUrl: string | null;
  instagram: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  recruitingOpen: boolean;
  recruitingUrl: string | null;
  recruitingText: string | null;
  attendeesVisibleToMembers: boolean;
  board: BoardMemberView[] | null;
}

export interface FollowerResponse {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  followedAt: string;
}

/** web/media/dto/SignUploadRequest(@NotBlank filename, @NotBlank contentType, @Positive long sizeBytes). */
export const SignUploadRequest = jv.object({
  filename: jv.string({ notBlank: true }),
  contentType: jv.string({ notBlank: true }),
  sizeBytes: jv.long({ primitive: true, positive: true }),
});
export type SignUploadRequest = NonNullable<z.output<typeof SignUploadRequest>>;

// ------------------------------------------------------------------ members

/** OrganizationMembershipService.MemberView. */
export interface MemberView {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  title: string | null;
  showOnPortal: boolean;
  since: string | null;
}

/** OrganizationMembershipService.InviteView. */
export interface InviteView {
  email: string;
  role: string;
  createdAt: string;
}

export interface InviteResult {
  added: MemberView[];
  pending: InviteView[];
}

export interface MemberSettings {
  attendeesVisibleToMembers: boolean;
}

export interface MembersResponse {
  members: MemberView[];
  invites: InviteView[];
  settings: MemberSettings;
}

/** OrgMembersController.SettingsRequest (no @Valid). */
export const SettingsRequest = jv.object({ attendeesVisibleToMembers: jv.bool() });

/** OrgMembersController.InviteRequest(@NotEmpty @Size(max = 50) List<String> emails, String role). */
export const InviteRequest = jv.object({
  emails: jv.list(jv.string(), { notEmpty: true, size: { max: 50 } }),
  role: jv.string(),
});

/** OrgMembersController.UpdateMemberRequest(String role, @Size(max = 60) String title, Boolean showOnPortal). */
export const UpdateMemberRequest = jv.object({
  role: jv.string(),
  title: jv.string({ size: { max: 60 } }),
  showOnPortal: jv.bool(),
});

// ------------------------------------------------------------------ votes

/** VoteRequest(@NotBlank @Pattern(regexp = "up|down", message = "type must be 'up' or 'down'") type). */
export const VoteRequest = jv.object({
  type: jv.string({ notBlank: true, check: matches(/^(?:up|down)$/, "type must be 'up' or 'down'") }),
});

/** VoteResponse(int up, int down). */
export interface VoteResponse {
  up: number;
  down: number;
}
