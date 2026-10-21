// Port of GlobalExceptionHandlerTest: the app's error mapping (src/http/app.ts
// errorResponse) for each kind of exception, through a throwaway route that
// throws it, so status, body, path and headers come out of the real pipeline.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { buildDeps, type Deps } from '../../src/deps';
import { createApp, type App } from '../../src/http/app';
import { silentLogger } from '../../src/infra/logger';

let app: App;
let deps: Deps;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'geh-'));
  mkdirSync(join(dir, 'boom'));
  const src = (p: string) => JSON.stringify(join(import.meta.dir, '..', '..', 'src', p));
  writeFileSync(join(dir, 'boom', 'routes.ts'), `
    import * as E from ${src('http/errors')};
    import { StudyGroupConflictError } from ${src('features/studygroup/errors')};
    import { defineRoutes } from ${src('http/router')};
    import { param } from ${src('http/validation')};
    const errors = {
      notFound: () => new E.ResourceNotFoundError('Subject', 'XYZ'),
      exists: () => new E.ResourceAlreadyExistsError('User', 'alice@itba.edu.ar'),
      notConfigured: () => new E.FeatureNotConfiguredError('Cloud storage not configured.'),
      validation: () => new E.ValidationError('year', -1, 'must be non-negative'),
      integrity: () => Object.assign(new Error('FK violation'), { code: '23503' }),
      external: () => new E.ExternalApiError('ITBA', 'getCommissions', new Error('timeout')),
      unhandled: () => new Error('internal detail clients should not see'),
      unreadable: () => new E.MalformedBodyError(),
      sgFull: () => new StudyGroupConflictError('FULL', 'Study group is full'),
      sgForbidden: () => new E.StudyGroupForbiddenError('edit'),
      method: () => new E.MethodNotAllowedError('PUT', ['GET', 'POST']),
      media: () => new E.UnsupportedMediaTypeError('text/plain;charset=UTF-8'),
      header: () => new E.CodedError(400, 'BadRequest', "Required header 'X-Thing' is not present."),
    };
    export default defineRoutes((r) => {
      r.get('/v1/some/path', { query: { e: param.string() } }, ({ query }) => { throw errors[query.e](); });
    });`);
  const config = await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/none' });
  deps = await buildDeps(config, { log: silentLogger, push: null });
  app = await createApp(deps, { featuresDir: dir });
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await deps?.close();
});

async function call(e: string) {
  const r = await app.request(`http://localhost/api/v1/some/path?e=${e}`, { headers: { 'X-Api-Key': 'test-sync-key' } });
  return { status: r.status, headers: r.headers, body: await r.json() as { error: string; message: string; path: string; timestamp: string } };
}

describe('GlobalExceptionHandlerTest', () => {
  test('resourceNotFoundMapsTo404', async () => {
    const r = await call('notFound');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: 'ResourceNotFound', message: "Subject with identifier 'XYZ' not found", path: '/api/v1/some/path' });
    expect(r.body.timestamp).toBeString();
  });
  test('resourceAlreadyExistsMapsTo409', async () => {
    const r = await call('exists');
    expect([r.status, r.body.error]).toEqual([409, 'ResourceAlreadyExists']);
  });
  test('featureNotConfiguredMapsTo501', async () => {
    const r = await call('notConfigured');
    expect([r.status, r.body.error, r.body.message]).toEqual([501, 'NotImplemented', 'Cloud storage not configured.']);
  });
  test('validationExceptionMapsTo400', async () => {
    const r = await call('validation');
    expect([r.status, r.body.error]).toEqual([400, 'ValidationError']);
    expect(r.body.message).toContain('year');
    expect(r.body.message).toContain('must be non-negative');
  });
  test('dataIntegrityViolationMapsTo409', async () => {
    const r = await call('integrity');
    expect([r.status, r.body.error]).toEqual([409, 'DataIntegrityViolation']);
    expect(r.body.message).not.toContain('FK violation');
  });
  test('externalApiExceptionMapsTo502', async () => {
    const r = await call('external');
    expect([r.status, r.body.error]).toEqual([502, 'ExternalApiError']);
  });
  test('unhandledExceptionMapsTo500WithGenericMessage', async () => {
    const r = await call('unhandled');
    expect([r.status, r.body.error, r.body.message]).toEqual([500, 'InternalServerError', 'An unexpected error occurred']);
  });
  test('unreadableBodyMapsTo400WithoutEchoingParserDetails', async () => {
    const r = await call('unreadable');
    expect([r.status, r.body.error, r.body.message]).toEqual([400, 'BadRequest', 'Malformed or invalid request body']);
  });
  test('studyGroupConflictMapsTo409WithReasonCode', async () => {
    const r = await call('sgFull');
    expect([r.status, r.body.error]).toEqual([409, 'StudyGroupFull']);
  });
  test('studyGroupForbiddenMapsTo403', async () => {
    const r = await call('sgForbidden');
    expect([r.status, r.body.error]).toEqual([403, 'AccessDenied']);
  });
  test('methodNotSupportedMapsTo405WithAllowHeader', async () => {
    const r = await call('method');
    expect([r.status, r.body.error, r.body.path]).toEqual([405, 'MethodNotAllowed', '/api/v1/some/path']);
    expect(r.headers.get('Allow')).toContain('GET');
  });
  test('mediaTypeNotSupportedMapsTo415', async () => {
    const r = await call('media');
    expect([r.status, r.body.error]).toEqual([415, 'UnsupportedMediaType']);
  });
  test('missingRequestHeaderMapsTo400', async () => {
    const r = await call('header');
    expect([r.status, r.body.error]).toEqual([400, 'BadRequest']);
  });
});
