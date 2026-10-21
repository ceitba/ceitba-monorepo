// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbPipelineException.java:
// pipeline errors with stable codes (GlobalExceptionHandler.handleKbPipeline: the reason's
// status, ErrorResponse error = the reason's code).

import { CodedError } from '../../../../http/errors';

export const REASONS = {
  LLM_UNCONFIGURED: { code: 'KB_LLM_UNCONFIGURED', status: 503 },
  RUN_ACTIVE: { code: 'KB_RUN_ACTIVE', status: 409 },
  RUN_NOT_ACTIVE: { code: 'KB_RUN_NOT_ACTIVE', status: 409 },
  RUN_NOT_BLOCKED: { code: 'KB_RUN_NOT_BLOCKED', status: 409 },
  EVAL_ACTIVE: { code: 'KB_EVAL_ACTIVE', status: 409 },
  NO_PAIRS: { code: 'KB_NO_PAIRS', status: 404 },
} as const;

export type Reason = keyof typeof REASONS;

export class KbPipelineError extends CodedError {
  constructor(readonly reason: Reason, message: string) {
    super(REASONS[reason].status, REASONS[reason].code, message);
    this.name = 'KbPipelineException';
  }
}
