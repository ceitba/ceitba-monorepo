// web/studygroup/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';
import { JAVA_NOT_S, JAVA_S } from '../../lib/javaCompat';

export const STUDY_GROUP_TYPES = ['TP_GRUPO', 'AHORA', 'EXAMEN', 'GUIAS'] as const;
export type StudyGroupType = (typeof STUDY_GROUP_TYPES)[number];
export const STUDY_GROUP_LOCATIONS = ['VIRTUAL', 'SDR', 'SDT', 'SDF'] as const;
export type StudyGroupLocation = (typeof STUDY_GROUP_LOCATIONS)[number];

/** @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL") */
const CONTACT_LINK = new RegExp(`^(?:${JAVA_S}*|https?://${JAVA_NOT_S}+)$`);
const contactLink = () => jv.string({
  size: { max: 2048 },
  check: (v: string) => (CONTACT_LINK.test(v) ? null : 'must be an http(s) URL'),
});

/** CreateStudyGroupRequest: dueAt arrives adjusted to UTC (Jackson ADJUST_DATES_TO_CONTEXT_TIME_ZONE). */
export const CreateStudyGroupRequest = jv.object({
  title: jv.string({ notBlank: true, size: { max: 120 } }),
  subjectId: jv.string({ notBlank: true, size: { max: 25 } }),
  type: jv.enum(STUDY_GROUP_TYPES, { notNull: true }),
  locations: jv.list(jv.enum(STUDY_GROUP_LOCATIONS, { notNull: true }), { notEmpty: true, size: { max: 4 } }),
  dueAt: jv.instant({ notNull: true }),
  description: jv.string({ size: { max: 2000 } }),
  contactLink: contactLink(),
  maxParticipants: jv.int({ min: 0, max: 50 }),
});
export type CreateStudyGroupRequest = NonNullable<z.output<typeof CreateStudyGroupRequest>>;

/** UpdateStudyGroupRequest: absent (null) fields are left unchanged. */
export const UpdateStudyGroupRequest = jv.object({
  title: jv.string({ size: { min: 1, max: 120 } }),
  subjectId: jv.string({ size: { min: 1, max: 25 } }),
  type: jv.enum(STUDY_GROUP_TYPES),
  locations: jv.list(jv.enum(STUDY_GROUP_LOCATIONS, { notNull: true }), { size: { min: 1, max: 4 } }),
  dueAt: jv.instant(),
  description: jv.string({ size: { max: 2000 } }),
  contactLink: contactLink(),
  maxParticipants: jv.int({ min: 0, max: 50 }),
});
export type UpdateStudyGroupRequest = NonNullable<z.output<typeof UpdateStudyGroupRequest>>;

export interface StudyGroupSubjectResponse { id: string; name: string | null }

/**
 * StudyGroupParticipantResponse(name, avatarUrl, @JsonProperty("isOwner") isOwner, joinedAt).
 * Jackson writes the @JsonProperty-renamed `isX` components LAST (verified on the jar).
 */
export interface StudyGroupParticipantResponse {
  name: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  isOwner: boolean;
}

/**
 * StudyGroupResponse. Key order as Jackson writes it (not the record order):
 * the @JsonProperty("isFull"/"isMember"/"isOwner") components go last.
 * participants is @JsonInclude(NON_NULL): absent on list items.
 */
export interface StudyGroupResponse {
  id: string;
  title: string;
  subject: StudyGroupSubjectResponse;
  type: StudyGroupType;
  locations: StudyGroupLocation[];
  dueAt: string;
  description: string | null;
  contactLink: string | null;
  maxParticipants: number | null;
  participantCount: number;
  canEdit: boolean;
  participants?: StudyGroupParticipantResponse[];
  createdAt: string;
  updatedAt: string;
  isFull: boolean;
  isMember: boolean;
  isOwner: boolean;
}
