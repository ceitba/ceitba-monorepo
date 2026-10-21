// web/share/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';
import type { RawJsonText } from './jsonbJackson';

/** CreateShareSessionRequest(@NotNull UUID savedScheduleId, @Size(max=120) displayName, @Size(max=120) name). */
export const CreateShareSessionRequest = jv.object({
  savedScheduleId: jv.uuid({ notNull: true }),
  displayName: jv.string({ size: { max: 120 } }),
  name: jv.string({ size: { max: 120 } }),
});
export type CreateShareSessionRequest = NonNullable<z.output<typeof CreateShareSessionRequest>>;

/** JoinShareSessionRequest(@NotNull UUID savedScheduleId, @Size(max=120) displayName). */
export const JoinShareSessionRequest = jv.object({
  savedScheduleId: jv.uuid({ notNull: true }),
  displayName: jv.string({ size: { max: 120 } }),
});
export type JoinShareSessionRequest = NonNullable<z.output<typeof JoinShareSessionRequest>>;

/** ParticipantResponse(userId, displayName, isCreator, careerId, plan, payload, joinedAt). */
export interface ParticipantResponse {
  userId: string;
  displayName: string;
  isCreator: boolean;
  careerId: string | null;
  plan: string | null;
  /** Map<String, Object> from jsonb, written as Jackson would. */
  payload: RawJsonText | null;
  joinedAt: string | null;
}

/** ShareSessionResponse(id, token, name, creatorDisplayName, expiresAt, createdAt, participants). */
export interface ShareSessionResponse {
  id: string;
  token: string;
  name: string | null;
  creatorDisplayName: string | null;
  expiresAt: string | null;
  createdAt: string;
  participants: ParticipantResponse[];
}
