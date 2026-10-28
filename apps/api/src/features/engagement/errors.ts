// Comments and polls conflicts (docs/NEWSLETTER-ENGAGEMENT.md): 409 with the reason's code.

import { CodedError } from '../../http/errors';

export const ENGAGEMENT_REASONS = {
  COMMENTS_DISABLED: { code: 'CommentsDisabled', message: 'Comments are turned off for this article' },
  POLL_CLOSED: { code: 'PollClosed', message: 'This poll is closed' },
  POLL_HAS_VOTES: { code: 'PollHasVotes', message: 'The options of a poll with votes cannot change' },
} as const;
export type EngagementConflictReason = keyof typeof ENGAGEMENT_REASONS;

export class EngagementConflictError extends CodedError {
  constructor(readonly reason: EngagementConflictReason) {
    super(409, ENGAGEMENT_REASONS[reason].code, ENGAGEMENT_REASONS[reason].message);
  }
}
