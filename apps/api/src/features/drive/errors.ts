// service/drive/DriveException (+ GlobalExceptionHandler.handleDrive) and the
// DriveAccess not-found helpers.
import { CodedError, ResourceNotFoundError } from '../../http/errors';

export const DRIVE_REASONS = {
  INVALID_FOLDER_URL: ['DRIVE_INVALID_FOLDER_URL', 400],
  FOLDER_NOT_SHARED: ['DRIVE_FOLDER_NOT_SHARED', 422],
  FOLDER_NOT_OWNED: ['DRIVE_FOLDER_NOT_OWNED', 403],
  SOURCE_EXISTS: ['DRIVE_SOURCE_EXISTS', 409],
  SOURCE_BLOCKED: ['DRIVE_SOURCE_BLOCKED', 409],
  SYNC_RATE_LIMITED: ['DRIVE_SYNC_RATE_LIMITED', 429],
  SYNC_UNCONFIGURED: ['DRIVE_SYNC_UNCONFIGURED', 503],
} as const;
export type DriveReason = keyof typeof DRIVE_REASONS;

export class DriveError extends CodedError {
  constructor(readonly reason: DriveReason, message: string, readonly retryAfterSeconds = 0) {
    super(DRIVE_REASONS[reason][1], DRIVE_REASONS[reason][0], message,
      reason === 'SYNC_RATE_LIMITED' && retryAfterSeconds > 0 ? { 'Retry-After': String(retryAfterSeconds) } : {});
  }
}

export const fileNotFound = (id: unknown) => new ResourceNotFoundError('DriveFile', String(id));
export const sourceNotFound = (id: unknown) => new ResourceNotFoundError('DriveSource', String(id));

/** e.getClass().getSimpleName() of the Java exception a TS error stands for (sync_error / last_error texts). */
export function javaSimpleName(e: unknown): string {
  const n = (e as { constructor?: { name?: string } })?.constructor?.name ?? 'RuntimeException';
  const map: Record<string, string> = {
    FeatureNotConfiguredError: 'FeatureNotConfiguredException',
    ExternalApiError: 'ExternalApiException',
    TypeError: 'NullPointerException',
    Error: 'RuntimeException',
  };
  if (map[n]) return map[n]!;
  if (n.endsWith('Error')) return `${n.slice(0, -5)}Exception`;
  return n;
}
