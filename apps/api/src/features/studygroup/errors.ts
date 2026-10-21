// service/studygroup/StudyGroupConflictException: 409 with the reason's code.

import { CodedError } from '../../http/errors';

export const STUDY_GROUP_CONFLICT = {
  FULL: 'StudyGroupFull',
  PAST_DUE: 'StudyGroupPastDue',
  CAPACITY_BELOW_MEMBERS: 'StudyGroupCapacityBelowMembers',
} as const;
export type StudyGroupConflictReason = keyof typeof STUDY_GROUP_CONFLICT;

export class StudyGroupConflictError extends CodedError {
  constructor(readonly reason: StudyGroupConflictReason, message: string) {
    super(409, STUDY_GROUP_CONFLICT[reason], message);
  }
}
