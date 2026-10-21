// Ports apps/api/src/test/java/org/ceitba/api/web/HealthAndErrorIT.java and
// web/health/HealthProbesIT.java.
import { beforeAll, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, supports, TARGET, useServer } from '../support';

const api = useServer();
let staff: ReturnType<typeof bearer>;
const hasArticles = await supports('GET /v1/articles');

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

describe('HealthAndErrorIT', () => {
  test('rootReturnsApiStatus', async () => {
    const r = await api.get('/');
    expect(r.status).toBe(200);
    expect(r.json.message).toBe('CEITBA API is running');
    expect(r.json.version).toBe('1.0.0');
    expect(r.json.timestamp).toBeDefined();
  });

  test('healthReturnsHealthy', async () => {
    const r = await api.get('/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('healthy');
    expect(r.json.uptime).toBeDefined();
    expect(r.json.memory.used).toBeDefined();
  });

  test('actuatorHealthReturns200', async () => {
    const r = await api.get('/actuator/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('UP');
  });

  // The ITs read springdoc's default /v3/api-docs; production (and this run) serve /docs.json.
  test('openApiDocsAreServed', async () => {
    const r = await api.get('/docs.json');
    expect(r.status).toBe(200);
    expect(r.json.info.title).toBe('CEITBA API');
    expect(r.json.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(r.json.components.securitySchemes.apiKey.in).toBe('header');
    // springdoc's document: component schemas, Java operationIds, typed parameters.
    expect(Object.keys(r.json.components.schemas).length).toBeGreaterThan(200);
    expect(r.json.components.schemas.CareerResponse.properties.plans.type).toBe('array');
    const op = r.json.paths['/v1/careers/{id}'].get;
    expect(op.operationId).toBe('getCareerById');
    expect(op.responses['200'].content['*/*'].schema.$ref).toBe('#/components/schemas/CareerResponse');
    expect(r.json.servers).toEqual([{ url: `${api.url}/api`, description: 'Generated server url' }]);
  });

  // TS serves its own Swagger UI page (springdoc's loaded the URL through swagger-initializer.js).
  test.skipIf(TARGET === 'java')('swaggerUiLoadsTheDocument', async () => {
    const ui = await api.get('/swagger-ui/index.html');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('/api/docs.json');
  });

  test.skipIf(!hasArticles)('wrongMethodReturns405', async () => {
    const r = await api.put('/v1/articles', { as: staff });
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).not.toBeNull();
    expect(r.json.error).toBe('MethodNotAllowed');
    expect(r.json.path).toBe('/api/v1/articles');
  });

  test.skipIf(!hasArticles)('wrongContentTypeReturns415', async () => {
    const r = await api.post('/v1/articles', { as: staff, body: 'hello', contentType: 'text/plain' });
    expect(r.status).toBe(415);
    expect(r.json.error).toBe('UnsupportedMediaType');
  });

  // Same two rules on a route every target has (careers), so they run on ts before news is ported.
  test('wrongMethodReturns405 (careers)', async () => {
    const r = await api.patch('/v1/careers/S', { as: staff });
    expect(r.status).toBe(405);
    // Spring builds Allow from a HashSet: same methods, no stable order.
    expect(new Set(r.headers.get('Allow')!.split(', '))).toEqual(new Set(['GET', 'PUT', 'DELETE']));
    expect(r.json).toMatchObject({ error: 'MethodNotAllowed', message: "Method 'PATCH' is not supported.", path: '/api/v1/careers/S' });
  });

  test('wrongContentTypeReturns415 (careers)', async () => {
    const r = await api.post('/v1/careers', { as: staff, body: 'hello', contentType: 'text/plain' });
    expect(r.status).toBe(415);
    expect(r.headers.get('Accept')).toBe('application/json, application/*+json');
    expect(r.json).toMatchObject({ error: 'UnsupportedMediaType', message: "Content-Type 'text/plain;charset=UTF-8' is not supported." });
  });
});

describe('HealthProbesIT', () => {
  test('readinessAndLivenessAreUpAndPublic', async () => {
    const ready = await api.get('/actuator/health/readiness');
    expect(ready.status).toBe(200);
    expect(ready.json.status).toBe('UP');
    const live = await api.get('/actuator/health/liveness');
    expect(live.status).toBe(200);
    expect(live.json.status).toBe('UP');
  });
});

// Not in the Java suite: the error/edge contract the rewrite must keep (probed against the jar).
describe('Spring MVC and security edges', () => {
  test('unknownRouteIs401AnonymousAnd404Authenticated', async () => {
    const anon = await api.get('/v1/nope');
    expect(anon.status).toBe(401);
    expect(anon.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(anon.text).toBe('');
    const authed = await api.get('/v1/nope', { as: staff, query: { x: 1 } });
    expect(authed.status).toBe(404);
    expect(authed.json).toMatchObject({ error: 'NotFound', message: 'No static resource v1/nope.', path: '/api/v1/nope' });
    expect(authed.json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3}|\.\d{6}|\.\d{9})?Z$/);
    const trailing = await api.get('/v1/careers/', { as: staff });
    expect(trailing.status).toBe(404);
    expect(trailing.json.message).toBe('No static resource v1/careers.');
  });

  test('securityHeadersOnEveryResponse', async () => {
    const r = await api.get('/v1/careers');
    expect(r.headers.get('Cache-Control')).toBe('no-cache, no-store, max-age=0, must-revalidate');
    expect(r.headers.get('Pragma')).toBe('no-cache');
    expect(r.headers.get('Expires')).toBe('0');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('X-XSS-Protection')).toBe('0');
    expect(r.headers.get('Vary')).toBe('Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    expect(r.headers.get('Content-Type')).toBe('application/json');
  });

  test('corsPreflightAndRejection', async () => {
    const pre = await api.options('/v1/careers', { headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-api-key' } });
    expect(pre.status).toBe(200);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,DELETE,OPTIONS,PATCH');
    expect(pre.headers.get('Access-Control-Allow-Headers')).toBe('content-type, x-api-key');
    const bad = await api.options('/v1/careers', { headers: { Origin: 'http://evil.com', 'Access-Control-Request-Method': 'POST' } });
    expect(bad.status).toBe(403);
    expect(bad.text).toBe('Invalid CORS request');
    const simple = await api.get('/v1/careers', { headers: { Origin: 'https://ceitba.org.ar' } });
    expect(simple.status).toBe(200);
    expect(simple.headers.get('Access-Control-Allow-Origin')).toBe('https://ceitba.org.ar');
  });

  test('headOnAPublicGetIsNotPermitted', async () => {
    // permitAll matchers are HttpMethod.GET only.
    const r = await api.head('/v1/careers');
    expect(r.status).toBe(401);
  });

  test('actuatorContentType', async () => {
    const r = await api.get('/actuator/health/liveness');
    expect(r.headers.get('Content-Type')).toBe('application/vnd.spring-boot.actuator.v3+json');
    expect(r.text).toBe('{"status":"UP"}');
    expect((await api.get('/actuator/health')).text).toBe('{"status":"UP","groups":["liveness","readiness"]}');
    expect((await api.get('/actuator/info')).text).toBe('{}');
  });

  test('malformedAndBadBodies', async () => {
    const bad = await api.post('/v1/careers', { as: staff, body: '{bad' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'BadRequest', message: 'Malformed or invalid request body' });
    expect((await api.post('/v1/careers', { as: staff, body: '[]' })).status).toBe(400);
    expect((await api.post('/v1/careers', { as: staff, body: 'null' })).status).toBe(400);
    expect((await api.post('/v1/careers', { as: staff })).json?.message).toBe('Malformed or invalid request body');
    const noType = await api.post('/v1/careers', { as: staff, body: '{}', contentType: null });
    expect(noType.status).toBe(415);
    expect(noType.json.message).toBe("Content-Type 'application/octet-stream' is not supported.");
  });

  test('pathVariableConversionError', async () => {
    const r = await api.delete('/v1/auth/api-keys/abc', { as: staff });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Method parameter 'id': Failed to convert value of type 'java.lang.String' to required type 'java.util.UUID'; Invalid UUID string: abc");
  });

  test('rootWithoutSlashRedirects', async () => {
    const r = await api.request('GET', '/api', { rawPath: true });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${api.url.replace('127.0.0.1', '127.0.0.1')}/api/`);
  });
});
