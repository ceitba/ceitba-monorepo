// service/correction/ScheduleCorrectionException: SAME_AS_SGA -> 400, the others 409.

import { CodedError } from '../../http/errors';

export const SCHEDULE_CORRECTION_REASONS = {
  SAME_AS_SGA: { code: 'SameAsSga', status: 400 },
  COMMISSION_ENDED: { code: 'CommissionEnded', status: 409 },
  ALREADY_SUGGESTED: { code: 'AlreadySuggested', status: 409 },
} as const;
export type ScheduleCorrectionReason = keyof typeof SCHEDULE_CORRECTION_REASONS;

export class ScheduleCorrectionError extends CodedError {
  constructor(readonly reason: ScheduleCorrectionReason, message: string) {
    super(SCHEDULE_CORRECTION_REASONS[reason].status, SCHEDULE_CORRECTION_REASONS[reason].code, message);
  }
}
