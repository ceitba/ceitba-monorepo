// Subject review errors (docs/SUBJECT-REVIEWS.md "Errors"): one class, the
// reason decides status and code.

import { CodedError } from '../../http/errors';

export const REVIEW_ERRORS = {
  ALREADY_REVIEWED: [409, 'SubjectReviewExists'],
  HIDDEN: [409, 'SubjectReviewHidden'],
  FUTURE_TERM: [400, 'SubjectReviewFutureTerm'],
  OWN_REVIEW: [400, 'SubjectReviewOwn'],
  UNKNOWN_PROFESSOR: [400, 'UnknownProfessor'],
  PROFESSOR_EMAIL_DOMAIN: [400, 'ProfessorEmailDomain'],
  PROFESSOR_NOT_FOUND: [404, 'ProfessorNotFound'],
  DIRECTORY_UNAVAILABLE: [503, 'ProfessorDirectoryUnavailable'],
} as const;
export type ReviewErrorReason = keyof typeof REVIEW_ERRORS;

export class ReviewError extends CodedError {
  constructor(readonly reason: ReviewErrorReason, message: string) {
    super(REVIEW_ERRORS[reason][0], REVIEW_ERRORS[reason][1], message);
  }
}
