// web/user/dto/* and the records nested in the user controllers.
//
// Key order note (verified on the jar): Jackson writes the record components
// renamed with @JsonProperty AFTER the others (UserResponse: file_number,
// career_id last; SavedScheduleResponse: isPrimary last).

import { z } from 'zod';
import { jv } from '../../http/validation';

/**
 * @JsonProperty renames: the JSON key binds the Java component, whose name is
 * what Bean Validation reports ("fileNumber: must be greater than 0"); the
 * Java name itself is not a JSON property (ignored, like any unknown key).
 */
function jsonNames<S extends z.ZodType>(renames: Record<string, string>, schema: S) {
  const javaNames = new Set(Object.values(renames));
  return z.any().transform((v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (javaNames.has(k)) continue;
      out[renames[k] ?? k] = x;
    }
    return out;
  }).pipe(schema);
}

export { RegisterDeviceRequest } from './logic/registerDeviceRequest';

/** CreateUserRequest(@NotBlank @Email email, name, @JsonProperty("file_number") @Positive fileNumber, @JsonProperty("career_id") careerId, plan). */
export const CreateUserRequest = jsonNames({ file_number: 'fileNumber', career_id: 'careerId' }, jv.object({
  email: jv.string({ notBlank: true, email: true }),
  name: jv.string(),
  fileNumber: jv.int({ positive: true }),
  careerId: jv.string(),
  plan: jv.string(),
}));
export type CreateUserRequest = NonNullable<z.output<typeof CreateUserRequest>>;

/** UpdateFileNumberRequest(@JsonProperty("file_number") @Positive @Max(999_999) Integer fileNumber). */
export const UpdateFileNumberRequest = jsonNames({ file_number: 'fileNumber' }, jv.object({
  fileNumber: jv.int({ positive: true, max: 999_999 }),
}));
export type UpdateFileNumberRequest = NonNullable<z.output<typeof UpdateFileNumberRequest>>;

/** UpdatePreferencesRequest(@Pattern("light|dark|", message) theme, @Size(max = 5, message) language). */
export const UpdatePreferencesRequest = jv.object({
  theme: jv.string({ check: (v: string) => (/^(?:light|dark|)$/.test(v) ? null : "theme must be 'light' or 'dark'") }),
  language: jv.string({ check: (v: string) => (v.length <= 5 ? null : 'language code too long') }),
});
export type UpdatePreferencesRequest = NonNullable<z.output<typeof UpdatePreferencesRequest>>;

export const FILE_NUMBER_PATTERN = '^[1-9][0-9]{4,5}$';

/** UpdateProfileRequest: every field optional; null = leave alone, "" = clear (not fileNumber). */
export const UpdateProfileRequest = jv.object({
  fileNumber: jv.string({ check: (v: string) => (/^[1-9][0-9]{4,5}$/.test(v) ? null : 'must be the legajo: 5 or 6 digits, no leading zero') }),
  careerId: jv.string({ size: { max: 25 } }),
  plan: jv.string({ size: { max: 25 } }),
  linkedin: jv.string({ size: { max: 255 } }),
  instagram: jv.string({ size: { max: 255 } }),
  discord: jv.string({ size: { max: 64 } }),
});
export type UpdateProfileRequest = NonNullable<z.output<typeof UpdateProfileRequest>>;

/** SaveScheduleRequest(@NotBlank @Size(max = 120) name, @Size(16) careerId, @Size(255) plan, @NotNull Map payload). */
export const SaveScheduleRequest = jv.object({
  name: jv.string({ notBlank: true, size: { max: 120 } }),
  careerId: jv.string({ size: { max: 16 } }),
  plan: jv.string({ size: { max: 255 } }),
  payload: jv.map(jv.json(), { notNull: true }),
});
export type SaveScheduleRequest = NonNullable<z.output<typeof SaveScheduleRequest>>;

/** UserMembershipsController.AddMembershipRequest(@NotBlank slug, role). */
export const AddMembershipRequest = jv.object({
  slug: jv.string({ notBlank: true }),
  role: jv.string(),
});
export type AddMembershipRequest = NonNullable<z.output<typeof AddMembershipRequest>>;

/** UserMembershipsController.UpdateMembershipRequest(@NotBlank role). */
export const UpdateMembershipRequest = jv.object({
  role: jv.string({ notBlank: true }),
});
export type UpdateMembershipRequest = NonNullable<z.output<typeof UpdateMembershipRequest>>;

/** UserResponse(id, email, name, file_number, career_id, plan, avatarUrl, isStaff, organizations), written renamed-last. */
export interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  plan: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
  organizations: { slug: string; role: string }[];
  file_number: number | null;
  career_id: string | null;
}

/** MeProfileResponse(careerId, plan, fileNumber, linkedin, instagram, discord). */
export interface MeProfileResponse {
  careerId: string | null;
  plan: string | null;
  fileNumber: number | null;
  linkedin: string | null;
  instagram: string | null;
  discord: string | null;
}

/** MePreferencesResponse(theme, language). */
export interface MePreferencesResponse {
  theme: string | null;
  language: string | null;
}

/** DeviceResponse(token, platform, appVersion, createdAt, lastSeenAt). */
export interface DeviceResponse {
  token: string;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * SavedScheduleResponse(id, name, careerId, plan, payload, @JsonProperty("isPrimary") isPrimary, createdAt, updatedAt),
 * written with isPrimary last. `payload` is raw Jackson JSON text.
 */
export interface SavedScheduleResponse {
  id: string;
  name: string;
  careerId: string | null;
  plan: string | null;
  payloadJson: string;
  createdAt: string | null;
  updatedAt: string | null;
  isPrimary: boolean;
}
