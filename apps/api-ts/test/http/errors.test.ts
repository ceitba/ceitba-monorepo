// Every mapping of apps/api/.../web/error/GlobalExceptionHandler.java has a TS
// error class with the same status / `error` code, and the app's mapper turns
// any CodedError (also feature subclasses) into ErrorResponse.
import { expect, test } from 'bun:test';
import * as E from '../../src/http/errors';
import { DigestException } from '../../src/features/digest/logic/digestException';
import { testApp } from '../support/app';

const cases: [E.ApiError, number, string, string?][] = [
  [new E.ResourceNotFoundError('Career', 'X'), 404, 'ResourceNotFound', "Career with identifier 'X' not found"],
  [new E.ResourceAlreadyExistsError('Career', 'X'), 409, 'ResourceAlreadyExists', "Career with identifier 'X' already exists"],
  [new E.LastActiveStaffError('m'), 409, 'LastActiveStaff'],
  [new E.LastOrgAdminError('m'), 409, 'LastOrgAdmin'],
  [new E.FileNumberAlreadySetError('m'), 409, 'FileNumberAlreadySet'],
  [new E.FileNumberTakenError('m'), 409, 'FileNumberTaken'],
  [new E.MailSenderNotConnectedError('m'), 409, 'MAIL_SENDER_NOT_CONNECTED'],
  [new E.KbEndpointInUseError('m'), 409, 'KB_ENDPOINT_IN_USE'],
  [new E.BookmarkLimitError('m'), 409, 'BOOKMARK_LIMIT'],
  [new E.CapabilityRequiredError('apuntes'), 403, 'CAPABILITY_REQUIRED', "This feature requires the 'apuntes' capability"],
  [new E.StudyGroupForbiddenError('m'), 403, 'AccessDenied'],
  [new E.InvalidStateError('m'), 409, 'InvalidState'],
  [new E.RateLimitExceededError(7), 429, 'TooManyRequests', 'Rate limit exceeded. Retry in 7s.'],
  [new E.InvalidBenefitSlugError('m'), 400, 'InvalidSlug'],
  [new E.ValidationError('f', null, 'r'), 400, 'ValidationError', "Validation failed for field 'f' with value 'null': r"],
  [new E.BeanValidationError([{ field: 'a', message: 'x' }, { field: 'b', message: 'y' }]), 400, 'ValidationError', 'a: x; b: y'],
  [new E.ConstraintViolationError('m'), 400, 'ValidationError'],
  [new E.MissingParameterError('q'), 400, 'BadRequest', "Required request parameter 'q' for method parameter type String is not present"],
  [new E.MalformedBodyError(), 400, 'BadRequest', 'Malformed or invalid request body'],
  [new E.DataIntegrityViolationError(), 409, 'DataIntegrityViolation', 'Operation violates a database constraint'],
  [new E.ExternalApiError('ITBA API', 'sync'), 502, 'ExternalApiError', 'External API error in ITBA API during sync'],
  [new E.FeatureNotConfiguredError('m'), 501, 'NotImplemented'],
  [new E.InvalidTokenError('m'), 401, 'invalid_token'],
  [new E.InvalidCredentialsError(), 401, 'invalid_credentials', 'Invalid email or password'],
  [new E.ReviewLoginDisabledError(), 404, 'NotFound', 'Not found'],
  [new E.InsufficientScopeError('m'), 403, 'INSUFFICIENT_SCOPE'],
  [new E.ReviewAccountRestrictedError('m'), 403, 'AccessDenied'],
  [new E.LoginRejectedError('WORKSPACE_NOT_ALLOWED'), 403, 'unauthorized_workspace'],
  [new E.AccessDeniedError(), 403, 'AccessDenied', 'Insufficient permissions'],
  [new E.NoResourceFoundError('/v1/x/'), 404, 'NotFound', 'No static resource v1/x.'],
  [new E.MethodNotAllowedError('PATCH', ['GET']), 405, 'MethodNotAllowed', "Method 'PATCH' is not supported."],
  [new E.UnsupportedMediaTypeError('text/plain'), 415, 'UnsupportedMediaType'],
  [new E.InternalServerError(), 500, 'InternalServerError', 'An unexpected error occurred'],
  [new DigestException('TOKEN_EXPIRED', 'm'), 410, 'TOKEN_EXPIRED'],
];

test.each(cases.map((c) => [c[2], c[0], c[1], c[2], c[3] ?? ''] as const))('%s', (_n, err, status, code, message) => {
  expect(err.status).toBe(status);
  expect(err.code).toBe(code);
  if (message) expect(err.message).toBe(message);
  const body = err.body('/api/x', 1_000_000);
  expect(Object.keys(body)).toEqual(['error', 'message', 'path', 'timestamp']);
});

test('MailQuotaExhausted adds resumeAt and Retry-After', () => {
  const e = new E.MailQuotaExhaustedError('m', Date.now() * 1000 + 3_600_000_000);
  expect(e.status).toBe(429);
  expect(Object.keys(e.body('/p', 0))).toEqual(['error', 'message', 'path', 'timestamp', 'resumeAt']);
  expect(Number(e.headers()['Retry-After'])).toBeGreaterThan(3500);
});

test('the app maps domain errors to ErrorResponse', async () => {
  const t = await testApp();
  try {
    const r = await t.request('GET', '/v1/careers/NOPE');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
  } finally {
    await t.close();
  }
}, 30_000);
