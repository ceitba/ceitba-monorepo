// Every mapping of apps/api/.../web/error/GlobalExceptionHandler.java has a TS
// error class with the same status / `error` code, and the app's mapper turns
// any CodedError (also feature subclasses) into ErrorResponse.
import { expect, test } from 'bun:test';
import * as E from '../../src/http/errors';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DigestException } from '../../src/features/digest/logic/digestException';
import { ScheduleCorrectionError } from '../../src/features/correction/errors';
import { EventRsvpError } from '../../src/features/news/events';
import { EngagementConflictError } from '../../src/features/engagement/errors';
import { StudyGroupConflictError } from '../../src/features/studygroup/errors';
import { createApp } from '../../src/http/app';
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
  [new E.NotAcceptableError('text/html'), 406, 'NotAcceptable', 'Acceptable representations: [text/html].'],
  [new E.InternalServerError(), 500, 'InternalServerError', 'An unexpected error occurred'],
  [new DigestException('TOKEN_EXPIRED', 'm'), 410, 'TOKEN_EXPIRED'],
  // Feature exceptions with a reason enum: 409 (SameAsSga 400) and the reason's code.
  [new EventRsvpError('NOT_RSVP'), 409, 'EventNotRsvp', 'This event does not take RSVPs'],
  [new EventRsvpError('ENDED'), 409, 'EventEnded', 'This event already took place'],
  [new EventRsvpError('FULL'), 409, 'EventFull', 'This event is full'],
  [new StudyGroupConflictError('FULL', 'm'), 409, 'StudyGroupFull', 'm'],
  [new StudyGroupConflictError('PAST_DUE', 'm'), 409, 'StudyGroupPastDue'],
  [new StudyGroupConflictError('CAPACITY_BELOW_MEMBERS', 'm'), 409, 'StudyGroupCapacityBelowMembers'],
  [new ScheduleCorrectionError('SAME_AS_SGA', 'm'), 400, 'SameAsSga', 'm'],
  [new ScheduleCorrectionError('COMMISSION_ENDED', 'm'), 409, 'CommissionEnded'],
  [new ScheduleCorrectionError('ALREADY_SUGGESTED', 'm'), 409, 'AlreadySuggested'],
  [new EngagementConflictError('COMMENTS_DISABLED'), 409, 'CommentsDisabled', 'Comments are turned off for this article'],
  [new EngagementConflictError('POLL_CLOSED'), 409, 'PollClosed', 'This poll is closed'],
  [new EngagementConflictError('POLL_HAS_VOTES'), 409, 'PollHasVotes', 'The options of a poll with votes cannot change'],
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

test('a unique violation that escapes (also wrapped, like DuplicateKeyError) is 409 DataIntegrityViolation', async () => {
  const t = await testApp();
  const dir = mkdtempSync(join(tmpdir(), 'features-'));
  try {
    mkdirSync(join(dir, 'boom'));
    const src = (p: string) => JSON.stringify(join(import.meta.dir, '..', '..', 'src', p));
    writeFileSync(join(dir, 'boom', 'routes.ts'), `
      import { defineRoutes } from ${src('http/router')};
      import { DuplicateKeyError } from ${src('features/kb/logic/ports')};
      export default defineRoutes((r, deps) => {
        r.get('/v1/careers', {}, async () => {
          try { await deps.sql\`INSERT INTO public.careers (id, name, updated_at) VALUES ('X', 'a', now()), ('X', 'b', now())\`; }
          catch (e) { throw new DuplicateKeyError('careers_pkey', e); }
        });
      });`);
    const app = await createApp(t.deps, { featuresDir: dir });
    const res = await app.request('http://localhost/api/v1/careers'); // public GET
    expect(res.status).toBe(409);
    const body = await res.json();
    expect([body.error, body.message, body.path]).toEqual(['DataIntegrityViolation', 'Operation violates a database constraint', '/api/v1/careers']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
}, 30_000);

// Only the app's own errors (ApiError) reach the client with their message. An upstream library error that happens
// to carry a numeric `status` and a string `code` (gaxios from googleapis, ...) is the generic 500, so its text
// (URLs, upstream bodies) never leaks; an UnexpectedStateError (Java's IllegalStateException /
// NoSuchElementException, which GlobalExceptionHandler did not map) is the generic 500 too.
test('non-ApiErrors, even with a status and a code, answer the generic 500 without their message', async () => {
  const t = await testApp();
  const dir = mkdtempSync(join(tmpdir(), 'features-'));
  try {
    mkdirSync(join(dir, 'boom'));
    const src = (p: string) => JSON.stringify(join(import.meta.dir, '..', '..', 'src', p));
    writeFileSync(join(dir, 'boom', 'routes.ts'), `
      import { defineRoutes } from ${src('http/router')};
      import { UnexpectedStateError } from ${src('http/errors')};
      export default defineRoutes((r) => {
        r.get('/v1/careers', {}, async () => {
          throw Object.assign(new Error('GET https://upstream/secret-token failed'), { status: 403, code: 'ERR_UPSTREAM' });
        });
        r.get('/v1/careers/{id}', {}, async () => {
          throw new UnexpectedStateError('IllegalStateException', 'Could not allocate a unique share token after retries');
        });
      });`);
    const app = await createApp(t.deps, { featuresDir: dir });
    for (const path of ['/api/v1/careers', '/api/v1/careers/x']) {
      const res = await app.request(`http://localhost${path}`); // public GETs
      expect(res.status).toBe(500);
      const body = await res.json();
      expect([body.error, body.message, body.path]).toEqual(['InternalServerError', 'An unexpected error occurred', path]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
}, 30_000);
