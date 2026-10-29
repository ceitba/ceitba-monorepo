// web/plan/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

/** CreateSubjectPlanRequest(@NotBlank @Size(32) subjectId, @NotBlank @Size(255) section, year, semester, dependencies, @Min(0) creditsRequired). */
export const CreateSubjectPlanRequest = jv.object({
  subjectId: jv.string({ notBlank: true, size: { max: 32 } }),
  section: jv.string({ notBlank: true, size: { max: 255 } }),
  year: jv.int(),
  semester: jv.int(),
  dependencies: jv.list(jv.string()),
  creditsRequired: jv.int({ min: 0 }),
});
export type CreateSubjectPlanRequest = NonNullable<z.output<typeof CreateSubjectPlanRequest>>;

/** UpdateSubjectPlanRequest: all optional, null keeps the stored value. */
export const UpdateSubjectPlanRequest = jv.object({
  section: jv.string({ size: { max: 255 } }),
  year: jv.int(),
  semester: jv.int(),
  dependencies: jv.list(jv.string()),
  creditsRequired: jv.int({ min: 0 }),
});
export type UpdateSubjectPlanRequest = NonNullable<z.output<typeof UpdateSubjectPlanRequest>>;

/** SubjectPlanResponse(subjectId, planId, section, year, semester, dependencies, creditsRequired, subject). */
export interface SubjectPlanResponse {
  subjectId: string;
  planId: string;
  section: string;
  year: number;
  semester: number;
  dependencies: (string | null)[];
  creditsRequired: number | null;
  subject: { id: string; name: string; credits: number } | null;
}

/** PlanSectionRequirementResponse: the credits a plan asks for in one elective group, placed in a year and term. */
export interface PlanSectionRequirementResponse {
  section: string;
  credits: number;
  year: number;
  semester: number;
}
