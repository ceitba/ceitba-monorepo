// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestException.java.
// Weekly digest errors with a stable `error` code (docs/WEEKLY-DIGEST.md);
// GlobalExceptionHandler maps reason().status() and reason().code().

import { CodedError } from '../../../http/errors';

export const DIGEST_REASONS = {
  INVALID_WEEK_START: 400,
  DIGEST_EXISTS: 409,
  DIGEST_NOT_EDITABLE: 409,
  // Delete refused: stop the send first.
  DIGEST_SENDING: 409,
  DIGEST_EMPTY: 409,
  EMAIL_NOT_ALLOWED: 422,
  MAIL_DISABLED: 409,
  AUTO_SEND_IN_PAST: 400,
  INVALID_TOKEN: 400,
  // Correction vote links ("¿Es así?").
  TOKEN_EXPIRED: 410,
  INVALID_VOTE: 400,
  CORRECTION_NOT_FOUND: 404,
  // No longer PENDING/APPLIED, or its commission has ended.
  CORRECTION_CLOSED: 409,
} as const;

export type DigestReason = keyof typeof DIGEST_REASONS;

export class DigestException extends CodedError {
  constructor(readonly reason: DigestReason, message: string) {
    super(DIGEST_REASONS[reason], reason, message);
  }
}
