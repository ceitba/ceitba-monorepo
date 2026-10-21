// The error table of contract/COMPATIBILITY.md, generated from src/http/errors.ts and the feature errors
// (every `error` code the API answers, with its status and message). test/http/compatibility-doc.test.ts fails
// when the document's table is not this output: regenerate it with
//
//   bun contract/compatibility-errors.ts            # prints the table
//   bun contract/compatibility-errors.ts --write    # rewrites the block between the errors:begin/end markers

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as E from '../src/http/errors';
import { DRIVE_REASONS } from '../src/features/drive/errors';
import { DIGEST_REASONS } from '../src/features/digest/logic/digestException';
import { REASONS as KB_PIPELINE_REASONS } from '../src/features/kb/logic/pipeline/kbPipelineError';
import { ORG_MAIL_REASONS } from '../src/features/orgmail/service';
import { RSVP_REASONS } from '../src/features/news/events';
import { STUDY_GROUP_CONFLICT } from '../src/features/studygroup/errors';
import { SCHEDULE_CORRECTION_REASONS } from '../src/features/correction/errors';

export const DOC = join(import.meta.dir, 'COMPATIBILITY.md');
const TESTS = join(import.meta.dir, 'tests');

export interface Row { source: string; status: number; code: string; message: string }

const m = (s: string) => s.replace(/\|/g, '\\|');
const one = (e: E.ApiError, source: string, message?: string): Row => ({ source, status: e.status, code: e.code, message: message ?? e.message });

export function rows(): Row[] {
  const out: Row[] = [
    one(new E.ResourceNotFoundError('<Resource>', '<id>'), 'ResourceNotFoundError'),
    one(new E.ResourceAlreadyExistsError('<Resource>', '<id>'), 'ResourceAlreadyExistsError'),
    one(new E.ValidationError('<field>', '<value>', '<reason>'), 'ValidationError'),
    one(new E.BeanValidationError([{ field: '<field>', message: '<message>' }]), 'BeanValidationError (@Valid body)', '<field>: <message>; ... (request locale)'),
    one(new E.ConstraintViolationError('<message>'), 'ConstraintViolationError'),
    one(new E.MalformedBodyError(), 'MalformedBodyError'),
    one(new E.MissingParameterError('<name>'), 'MissingParameterError'),
    one(new E.ArgumentTypeMismatchError('<name>', '<value>', '<javaType>', '<cause>'), 'ArgumentTypeMismatchError'),
    one(new E.InvalidBenefitSlugError('<message>'), 'InvalidBenefitSlugError'),
    one(new E.InvalidTokenError('<message>'), 'InvalidTokenError'),
    one(new E.InvalidCredentialsError(), 'InvalidCredentialsError'),
    one(new E.AccessDeniedError(), 'AccessDeniedError (METHOD_RULES denial)'),
    one(new E.ReviewAccountRestrictedError('<message>'), 'ReviewAccountRestrictedError'),
    one(new E.StudyGroupForbiddenError('<message>'), 'StudyGroupForbiddenError'),
    one(new E.InsufficientScopeError('<message>'), 'InsufficientScopeError (API key scopes)'),
    one(new E.CapabilityRequiredError('<key>'), 'CapabilityRequiredError'),
    ...Object.keys(E.LOGIN_REJECTED).map((r) => one(new E.LoginRejectedError(r as E.LoginRejectedReason), `LoginRejectedError ${r}`)),
    one(new E.ReviewLoginDisabledError(), 'ReviewLoginDisabledError'),
    one(new E.NoResourceFoundError('/<path>'), 'NoResourceFoundError (no route)'),
    one(new E.MethodNotAllowedError('<METHOD>', ['GET']), 'MethodNotAllowedError (+ Allow)'),
    one(new E.PayloadTooLargeError(0), 'PayloadTooLargeError (body over the route cap; TS only)'),
    one(new E.UnsupportedMediaTypeError('<type>'), 'UnsupportedMediaTypeError (+ Accept)'),
    one(new E.NotAcceptableError('text/html'), 'NotAcceptableError (+ Accept; `produces` routes only)'),
  ];
  out.push(
    one(new E.InvalidStateError('<message>'), 'InvalidStateError'),
    one(new E.DataIntegrityViolationError(), 'DataIntegrityViolationError (SQLSTATE 22/23 that escapes)'),
    one(new E.LastActiveStaffError('<message>'), 'LastActiveStaffError'),
    one(new E.LastOrgAdminError('<message>'), 'LastOrgAdminError'),
    one(new E.FileNumberAlreadySetError('<message>'), 'FileNumberAlreadySetError'),
    one(new E.FileNumberTakenError('<message>'), 'FileNumberTakenError'),
    one(new E.BookmarkLimitError('<message>'), 'BookmarkLimitError'),
    one(new E.KbEndpointInUseError('<message>'), 'KbEndpointInUseError'),
    one(new E.MailSenderNotConnectedError('<message>'), 'MailSenderNotConnectedError / MailSenderNotConnected'),
    one(new E.RateLimitExceededError(7), 'RateLimitExceededError (per-user quotas; + Retry-After)', 'Rate limit exceeded. Retry in <n>s.'),
    { source: 'per-IP rate limit (security filter; + Retry-After, X-RateLimit-*)', status: 429, code: 'TooManyRequests', message: 'Rate limit exceeded. Retry in <n>s.' },
    one(new E.MailQuotaExhaustedError('<message>', 0), 'MailQuotaExhaustedError (+ resumeAt, Retry-After)'),
    one(new E.FeatureNotConfiguredError('<message>'), 'FeatureNotConfiguredError'),
    one(new E.ExternalApiError('<service>', '<operation>'), 'ExternalApiError'),
    one(new E.InternalServerError(), 'anything else (InternalServerError, UnexpectedStateError, foreign errors)'),
  );
  for (const [r, [code, status]] of Object.entries(DRIVE_REASONS)) out.push({ source: `DriveError ${r}`, status, code, message: '<message>' });
  for (const [r, status] of Object.entries(DIGEST_REASONS)) out.push({ source: `DigestException ${r}`, status, code: r, message: '<message>' });
  for (const [r, { code, status }] of Object.entries(KB_PIPELINE_REASONS)) out.push({ source: `KbPipelineError ${r}`, status, code, message: '<message>' });
  for (const [r, [code, message]] of Object.entries(ORG_MAIL_REASONS)) out.push({ source: `OrgMailError ${r}`, status: 409, code, message });
  for (const [r, { code, message }] of Object.entries(RSVP_REASONS)) out.push({ source: `EventRsvpError ${r}`, status: 409, code, message });
  for (const [r, code] of Object.entries(STUDY_GROUP_CONFLICT)) out.push({ source: `StudyGroupConflictError ${r}`, status: 409, code, message: '<message>' });
  for (const [r, { code, status }] of Object.entries(SCHEDULE_CORRECTION_REASONS)) out.push({ source: `ScheduleCorrectionError ${r}`, status, code, message: '<message>' });
  return out.sort((a, b) => a.status - b.status || a.code.localeCompare(b.code) || a.source.localeCompare(b.source));
}

/** Files that hold TS-only hardenings (skipped on the Java target): never the evidence for a Java-shared row. */
const TS_ONLY = new Set(['allowlist-public-reads.contract.test.ts', 'mail-oauth-binding.contract.test.ts',
  'rate-limit-decoded-path.contract.test.ts', 'request-body-size.contract.test.ts']);
/** Rows whose code other rows share: the test that exercises that very class. */
const OVERRIDES: Record<string, string> = {
  'AccessDeniedError (METHOD_RULES denial)': 'career.contract.test.ts',
  ReviewAccountRestrictedError: 'review-login.contract.test.ts',
  StudyGroupForbiddenError: 'studygroup-controller.contract.test.ts',
  ValidationError: 'api-key-scopes.contract.test.ts',
  'BeanValidationError (@Valid body)': 'validation-locale.contract.test.ts',
  'PayloadTooLargeError (body over the route cap; TS only)': 'request-body-size.contract.test.ts',
  'per-IP rate limit (security filter; + Retry-After, X-RateLimit-*)': 'rate-limit.contract.test.ts',
  'RateLimitExceededError (per-user quotas; + Retry-After)': 'media-endpoints.contract.test.ts',
};

/** The override, else the first dual-target contract test file (by name) naming the code in quotes, else the mapping test. */
function enforcedBy(r: Row, files: [string, string][]): string {
  const o = OVERRIDES[r.source];
  if (o) return `\`${o}\``;
  const hit = files.find(([f, text]) => !TS_ONLY.has(f) && (text.includes(`'${r.code}'`) || text.includes(`"${r.code}"`)));
  return hit ? `\`${hit[0]}\`` : '`test/http/errors.test.ts`';
}

export function errorTable(): string {
  const files = readdirSync(TESTS).filter((f) => f.endsWith('.contract.test.ts')).sort()
    .map((f) => [f, readFileSync(join(TESTS, f), 'utf8')] as [string, string]);
  const lines = ['| Status | `error` | Message | Thrown as | Enforced by |', '|---|---|---|---|---|'];
  for (const r of rows()) lines.push(`| ${r.status} | \`${r.code}\` | ${m(r.message)} | ${m(r.source)} | ${enforcedBy(r, files)} |`);
  return lines.join('\n');
}

const BEGIN = '<!-- errors:begin (generated: bun contract/compatibility-errors.ts --write) -->';
const END = '<!-- errors:end -->';

export function errorBlock(doc: string): string | null {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  return a < 0 || b < a ? null : doc.slice(a + BEGIN.length, b).trim();
}

if (import.meta.main) {
  const table = errorTable();
  if (process.argv.includes('--write')) {
    const doc = readFileSync(DOC, 'utf8');
    const a = doc.indexOf(BEGIN);
    const b = doc.indexOf(END);
    if (a < 0 || b < a) throw new Error(`markers not found in ${DOC}`);
    writeFileSync(DOC, `${doc.slice(0, a + BEGIN.length)}\n${table}\n${doc.slice(b)}`);
  } else {
    console.log(table);
  }
}
