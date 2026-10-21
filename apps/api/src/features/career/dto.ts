// web/career/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

/** CreateCareerRequest(@NotBlank @Size(max = 25) id, @NotBlank @Size(max = 255) name). */
export const CreateCareerRequest = jv.object({
  id: jv.string({ notBlank: true, size: { max: 25 } }),
  name: jv.string({ notBlank: true, size: { max: 255 } }),
});
export type CreateCareerRequest = NonNullable<z.output<typeof CreateCareerRequest>>;

/** UpdateCareerRequest(@NotBlank @Size(max = 255) name). */
export const UpdateCareerRequest = jv.object({
  name: jv.string({ notBlank: true, size: { max: 255 } }),
});
export type UpdateCareerRequest = NonNullable<z.output<typeof UpdateCareerRequest>>;

/** CreatePlanRequest(@NotBlank @Size(max = 25) id, @Size(max = 255) name). */
export const CreatePlanRequest = jv.object({
  id: jv.string({ notBlank: true, size: { max: 25 } }),
  name: jv.string({ size: { max: 255 } }),
});
export type CreatePlanRequest = NonNullable<z.output<typeof CreatePlanRequest>>;

/** CareerResponse(id, name, plans): plans always present (even empty). */
export interface CareerResponse {
  id: string;
  name: string;
  plans: string[];
}

/** PlanResponse(id, careerId, name). */
export interface PlanResponse {
  id: string;
  careerId: string;
  name: string | null;
}
