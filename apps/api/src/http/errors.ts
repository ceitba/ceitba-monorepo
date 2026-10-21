// Domain errors and their HTTP mapping: the TS port of
// apps/api/src/main/java/org/ceitba/api/web/error/GlobalExceptionHandler.java.
//
// Services throw these; nothing else picks a status. The body is always
// ErrorResponse(error, message, path, timestamp) (`errorBody`), except
// MailQuotaExhaustedError which adds `resumeAt` like MailQuotaErrorResponse.
//
// Feature-specific exceptions with a `reason` enum in Java (DriveException,
// DigestException, KbPipelineException, OrgMailException, EventRsvpException,
// StudyGroupConflictException, ScheduleCorrectionException) are ported by
// their feature as subclasses of CodedError with the reason's code/status.

import { ART, formatInstant, formatOffsetDateTime, systemNowMicros, type Micros } from '../lib/time';

export interface ErrorResponse {
  error: string;
  message: string | null;
  path: string;
  timestamp: string;
}

/** Base class: anything with an HTTP status and an ErrorResponse `error` code. */
export abstract class ApiError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  /** Extra response headers (Retry-After, Allow, Accept...). */
  headers(): Record<string, string> {
    return {};
  }
  /** The response body; ErrorResponse unless overridden. */
  body(path: string, nowMicros: Micros): Record<string, unknown> {
    return errorBody(this.code, this.message, path, nowMicros) as unknown as Record<string, unknown>;
  }
}

/** A Java exception mapped to a fixed (status, code). Subclass it for feature exceptions. */
export class CodedError extends ApiError {
  constructor(readonly status: number, readonly code: string, message: string, private readonly extraHeaders: Record<string, string> = {}) {
    super(message);
  }
  override headers() {
    return this.extraHeaders;
  }
}

export function errorBody(error: string, message: string | null, path: string, nowMicros: Micros = systemNowMicros()): ErrorResponse {
  return { error, message, path, timestamp: formatInstant(nowMicros) };
}

// ------------------------------------------------- common/exception/*

/** ResourceNotFoundException -> 404 ResourceNotFound. */
export class ResourceNotFoundError extends ApiError {
  readonly status = 404;
  readonly code = 'ResourceNotFound';
  constructor(resource: string, identifier: unknown) {
    super(`${resource} with identifier '${javaString(identifier)}' not found`);
  }
}

/** ResourceAlreadyExistsException -> 409 ResourceAlreadyExists. */
export class ResourceAlreadyExistsError extends ApiError {
  readonly status = 409;
  readonly code = 'ResourceAlreadyExists';
  constructor(resource: string, identifier: unknown) {
    super(`${resource} with identifier '${javaString(identifier)}' already exists`);
  }
}

/** ValidationException (domain) -> 400 ValidationError. */
export class ValidationError extends ApiError {
  readonly status = 400;
  readonly code = 'ValidationError';
  constructor(field: string, value: unknown, reason: string) {
    super(`Validation failed for field '${field}' with value '${javaString(value)}': ${reason}`);
  }
}

/**
 * MethodArgumentNotValidException (@Valid body) -> 400 ValidationError with
 * "field: message; field2: message2". Built by src/http/validation.ts.
 */
export class BeanValidationError extends ApiError {
  readonly status = 400;
  readonly code = 'ValidationError';
  constructor(readonly violations: { field: string; message: string }[]) {
    super(violations.map((v) => `${v.field}: ${v.message}`).join('; '));
  }
}

/** jakarta ConstraintViolationException (@Validated params) -> 400 ValidationError, raw message. */
export class ConstraintViolationError extends CodedError {
  constructor(message: string) {
    super(400, 'ValidationError', message);
  }
}

/** InvalidStateException -> 409 InvalidState. */
export class InvalidStateError extends CodedError {
  constructor(message: string) {
    super(409, 'InvalidState', message);
  }
}

/** FeatureNotConfiguredException -> 501 NotImplemented. */
export class FeatureNotConfiguredError extends CodedError {
  constructor(message: string) {
    super(501, 'NotImplemented', message);
  }
}

/** ExternalApiException -> 502 ExternalApiError (logged at ERROR). */
export class ExternalApiError extends ApiError {
  readonly status = 502;
  readonly code = 'ExternalApiError';
  constructor(service: string, operation: string, override readonly cause?: unknown) {
    super(`External API error in ${service} during ${operation}`);
  }
}

/** RateLimitExceededException -> 429 TooManyRequests + Retry-After (same as the per-IP filter). */
export class RateLimitExceededError extends ApiError {
  readonly status = 429;
  readonly code = 'TooManyRequests';
  constructor(readonly retryAfterSeconds: number) {
    super(`Rate limit exceeded. Retry in ${retryAfterSeconds}s.`);
  }
  override headers() {
    return { 'Retry-After': String(this.retryAfterSeconds) };
  }
}

// ------------------------------------------------- service/auth/*

/** InvalidTokenException -> 401 invalid_token. */
export class InvalidTokenError extends CodedError {
  constructor(message: string) {
    super(401, 'invalid_token', message);
  }
}

/** InvalidCredentialsException -> 401 invalid_credentials. */
export class InvalidCredentialsError extends CodedError {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid email or password');
  }
}

/** ReviewLoginDisabledException -> 404 NotFound "Not found". */
export class ReviewLoginDisabledError extends CodedError {
  constructor() {
    super(404, 'NotFound', 'Not found');
  }
}

/** InsufficientScopeException -> 403 INSUFFICIENT_SCOPE. */
export class InsufficientScopeError extends CodedError {
  constructor(message: string) {
    super(403, 'INSUFFICIENT_SCOPE', message);
  }
}

/** ReviewAccountRestrictedException -> 403 AccessDenied (own message). */
export class ReviewAccountRestrictedError extends CodedError {
  constructor(message: string) {
    super(403, 'AccessDenied', message);
  }
}

export const LOGIN_REJECTED = {
  UNVERIFIED_EMAIL: { code: 'unverified_email', message: 'Google account email is not verified' },
  NOT_ALLOWLISTED: { code: 'unauthorized', message: 'Email is not allowed to sign in' },
  WORKSPACE_NOT_ALLOWED: { code: 'unauthorized_workspace', message: 'Google Workspace domain is not allowed to sign in' },
} as const;
export type LoginRejectedReason = keyof typeof LOGIN_REJECTED;

/** LoginRejectedException -> 403 with the reason's code. */
export class LoginRejectedError extends ApiError {
  readonly status = 403;
  readonly code: string;
  constructor(readonly reason: LoginRejectedReason) {
    super(LOGIN_REJECTED[reason].message);
    this.code = LOGIN_REJECTED[reason].code;
  }
}

/**
 * AccessDeniedException / AuthorizationDeniedException (@PreAuthorize, @CurrentUser
 * without a user) -> 403 AccessDenied "Insufficient permissions" (the message is fixed).
 */
export class AccessDeniedError extends CodedError {
  constructor(detail = 'Access Denied') {
    super(403, 'AccessDenied', 'Insufficient permissions');
    this.detail = detail;
  }
  detail: string;
}

// ------------------------------------------------- feature exceptions with a fixed mapping

/** CapabilityRequiredException -> 403 CAPABILITY_REQUIRED. */
export class CapabilityRequiredError extends CodedError {
  constructor(capabilityKey: string) {
    super(403, 'CAPABILITY_REQUIRED', `This feature requires the '${capabilityKey}' capability`);
  }
}
/** StudyGroupForbiddenException -> 403 AccessDenied (own message). */
export class StudyGroupForbiddenError extends CodedError {
  constructor(message: string) { super(403, 'AccessDenied', message); }
}
/** LastActiveStaffException -> 409 LastActiveStaff. */
export class LastActiveStaffError extends CodedError {
  constructor(message: string) { super(409, 'LastActiveStaff', message); }
}
/** LastOrgAdminException -> 409 LastOrgAdmin. */
export class LastOrgAdminError extends CodedError {
  constructor(message: string) { super(409, 'LastOrgAdmin', message); }
}
/** FileNumberAlreadySetException -> 409 FileNumberAlreadySet. */
export class FileNumberAlreadySetError extends CodedError {
  constructor(message: string) { super(409, 'FileNumberAlreadySet', message); }
}
/** FileNumberTakenException -> 409 FileNumberTaken. */
export class FileNumberTakenError extends CodedError {
  constructor(message: string) { super(409, 'FileNumberTaken', message); }
}
/** BookmarkLimitException -> 409 BOOKMARK_LIMIT. */
export class BookmarkLimitError extends CodedError {
  constructor(message: string) { super(409, 'BOOKMARK_LIMIT', message); }
}
/** InvalidBenefitSlugException -> 400 InvalidSlug. */
export class InvalidBenefitSlugError extends CodedError {
  constructor(message: string) { super(400, 'InvalidSlug', message); }
}
/** KbEndpointService.EndpointInUseException -> 409 KB_ENDPOINT_IN_USE. */
export class KbEndpointInUseError extends CodedError {
  constructor(message: string) { super(409, 'KB_ENDPOINT_IN_USE', message); }
}
/** MailSenderNotConnectedException -> 409 MAIL_SENDER_NOT_CONNECTED. */
export class MailSenderNotConnectedError extends CodedError {
  constructor(message: string) { super(409, 'MAIL_SENDER_NOT_CONNECTED', message); }
}

/**
 * MailQuotaExhaustedException -> 429 MAIL_QUOTA_EXHAUSTED, Retry-After (>= 1 s)
 * and MailQuotaErrorResponse's extra `resumeAt` (OffsetDateTime in ART).
 */
export class MailQuotaExhaustedError extends ApiError {
  readonly status = 429;
  readonly code = 'MAIL_QUOTA_EXHAUSTED';
  constructor(message: string, readonly resumeAtMicros: Micros) {
    super(message);
  }
  override headers() {
    const secs = Math.max(1, Math.floor((this.resumeAtMicros - systemNowMicros()) / 1_000_000));
    return { 'Retry-After': String(secs) };
  }
  override body(path: string, nowMicros: Micros) {
    return { ...errorBody(this.code, this.message, path, nowMicros), resumeAt: formatOffsetDateTime(this.resumeAtMicros, ART) };
  }
}

// ------------------------------------------------- Spring MVC / infrastructure

/** DataIntegrityViolationException (SQLSTATE 22xxx/23xxx) -> 409, fixed message. */
export class DataIntegrityViolationError extends CodedError {
  constructor(override readonly cause?: unknown) {
    super(409, 'DataIntegrityViolation', 'Operation violates a database constraint');
  }
}

/** HttpMessageNotReadableException: unparseable/missing/wrong-shape JSON body. */
export class MalformedBodyError extends CodedError {
  constructor() {
    super(400, 'BadRequest', 'Malformed or invalid request body');
  }
}

/** MissingServletRequestParameterException -> 400 BadRequest. */
export class MissingParameterError extends CodedError {
  constructor(name: string, javaType = 'String') {
    super(400, 'BadRequest', `Required request parameter '${name}' for method parameter type ${javaType} is not present`);
  }
}

/** MethodArgumentTypeMismatchException -> 400 BadRequest. */
export class ArgumentTypeMismatchError extends CodedError {
  constructor(name: string, value: string, javaType: string, cause: string) {
    super(400, 'BadRequest', `Method parameter '${name}': Failed to convert value of type 'java.lang.String' to required type '${javaType}'; ${cause}`);
    void value;
  }
}

/** NoResourceFoundException -> 404 NotFound "No static resource v1/x." */
export class NoResourceFoundError extends CodedError {
  constructor(pathWithinApp: string) {
    super(404, 'NotFound', `No static resource ${pathWithinApp.replace(/^\/+/, '').replace(/\/+$/, '')}.`);
  }
}

/** HttpRequestMethodNotSupportedException -> 405 MethodNotAllowed + Allow. */
export class MethodNotAllowedError extends CodedError {
  constructor(method: string, allow: string[]) {
    super(405, 'MethodNotAllowed', `Method '${method}' is not supported.`, { Allow: allow.join(', ') });
  }
}

/** HttpMediaTypeNotSupportedException -> 415 UnsupportedMediaType + Accept. */
export class UnsupportedMediaTypeError extends CodedError {
  constructor(contentType: string, accept = 'application/json, application/*+json') {
    super(415, 'UnsupportedMediaType', `Content-Type '${contentType}' is not supported.`, { Accept: accept });
  }
}

/** MaxUploadSizeExceededException (Spring MVC ErrorResponse) -> 413 PayloadTooLarge. */
export class PayloadTooLargeError extends CodedError {
  constructor(maxBytes: number) {
    super(413, 'PayloadTooLarge', `Maximum upload size exceeded`);
    void maxBytes;
  }
}

/**
 * A Java unchecked exception that GlobalExceptionHandler had no mapping for, so it answered the generic 500
 * (`IllegalStateException`, `NoSuchElementException` from `Optional.orElseThrow()`): an "impossible" state. Not an
 * ApiError on purpose: the app logs it at ERROR and answers InternalServerError, never its message.
 */
export class UnexpectedStateError extends Error {
  constructor(readonly javaException: 'IllegalStateException' | 'NoSuchElementException', message: string) {
    super(message);
    this.name = `UnexpectedStateError(${javaException})`;
  }
}

/** Anything else -> 500 InternalServerError (logged at ERROR). */
export class InternalServerError extends CodedError {
  constructor() {
    super(500, 'InternalServerError', 'An unexpected error occurred');
  }
}

/** Java's String.valueOf for messages: null -> "null". */
export function javaString(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(javaString).join(', ')}]`;
  return String(v);
}
