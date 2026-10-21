// Content negotiation, checked against the Spring jar (b515215). The routes with `produces = text/html` (article and
// digest previews) answered 406 at handler mapping, after security and before the handler: a JSON NotAcceptable body
// when the Accept admits JSON, empty otherwise, `Accept: text/html` either way; `q` was ignored. JSON routes and the
// sitemap (preset Content-Type) ignore Accept. Where the Spring app's /error dispatch produced artifacts (401 for
// anonymous callers, whitelabel 500s, a 406 after a POST had already written), the TS app keeps answering normally:
// those cases are TS-only below (contract/COMPATIBILITY.md "Content negotiation").
import { beforeAll, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedCareer, seedStaff, TARGET, useServer, type As } from '../support';

const api = useServer();
const DIGEST = '/v1/digests/00000000-0000-0000-0000-000000000000/preview';
let staff: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
  await seedCareer(api.db, 'S', 'Sistemas');
});

/** A request without any Accept header (fetch would add Accept: * / *). */
async function withoutAccept(path: string): Promise<number> {
  const { port } = new URL(api.url);
  let raw = '';
  await new Promise<void>((resolve, reject) => {
    Bun.connect({ hostname: '127.0.0.1', port: Number(port), socket: {
      open(s) { s.write(`GET /api${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`); },
      data(_s, c) { raw += new TextDecoder().decode(c); },
      close() { resolve(); },
      error(_s, e) { reject(e); },
    } }).catch(reject);
  });
  return Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);
}

describe('ContentNegotiation', () => {
  test('aPreviewAnswers406JsonWhenTheAcceptAdmitsOnlyJson', async () => {
    for (const accept of ['application/json', 'application/*', 'application/json;q=0', 'application/json, image/png']) {
      const r = await api.get('/v1/articles/nope/preview', { headers: { Accept: accept } });
      expect(r.status).toBe(406);
      expect(r.headers.get('content-type')).toBe('application/json');
      expect(r.headers.get('accept')).toBe('text/html');
      expect(r.text).toStartWith('{"error":"NotAcceptable","message":"Acceptable representations: [text/html].","path":"/api/v1/articles/nope/preview","timestamp":"');
    }
    const problem = await api.get('/v1/articles/nope/preview', { headers: { Accept: 'application/problem+json' } });
    expect(problem.status).toBe(406);
    expect(problem.headers.get('content-type')).toBe('application/problem+json');
    expect(problem.json.error).toBe('NotAcceptable');
  });

  test('aPreviewAnswersWhenTheAcceptAdmitsHtml', async () => {
    for (const accept of ['text/html', '*/*', 'text/*', 'text/html;q=0, application/json', '*/*;q=0']) {
      const r = await api.get('/v1/articles/nope/preview', { headers: { Accept: accept } });
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toBe('text/html;charset=UTF-8');
    }
    expect(await withoutAccept('/v1/articles/nope/preview')).toBe(404);
  });

  test('aStaffDigestPreviewAnswers406', async () => {
    const json = await api.get(DIGEST, { as: staff, headers: { Accept: 'application/json' } });
    expect(json.status).toBe(406);
    expect(json.json.message).toBe('Acceptable representations: [text/html].');
    for (const accept of ['image/png', 'text/plain', 'garbage']) {
      const r = await api.get(DIGEST, { as: staff, headers: { Accept: accept } });
      expect(r.status).toBe(406);
      expect(r.text).toBe('');
      expect(r.headers.get('accept')).toBe('text/html');
    }
    expect((await api.get(DIGEST, { as: staff, headers: { Accept: '*/*' } })).status).toBe(404);
  });

  test('securityAnswersBeforeNegotiation', async () => {
    for (const accept of ['application/json', 'text/html']) {
      expect((await api.get(DIGEST, { headers: { Accept: accept } })).status).toBe(401);
    }
  });

  test('theSitemapIgnoresAccept', async () => {
    const r = await api.get('/v1/articles/sitemap.xml', { headers: { Accept: 'text/html' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/xml;charset=UTF-8');
  });
});

// Differences from the jar, where its answer came from Boot's /error dispatch rather than from the route.
describe.skipIf(TARGET === 'java')('ContentNegotiation (TS: no /error dispatch artifacts)', () => {
  test('jsonRoutesIgnoreAccept', async () => {
    // Java: 401 for an anonymous caller (the /error dispatch is not permitted), 406 for `garbage`.
    for (const accept of ['text/html', 'image/png', 'garbage']) {
      const r = await api.get('/v1/careers', { headers: { Accept: accept } });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/json');
    }
  });

  test('anAnonymousPreviewWithANonJsonAcceptIsA406', async () => {
    // Java: 401 (same /error dispatch).
    expect((await api.get('/v1/articles/nope/preview', { headers: { Accept: 'image/png' } })).status).toBe(406);
  });

  test('aMissingDigestPreviewIsA404Json', async () => {
    // Java: a whitelabel 500 (the JSON 404 could not be written as text/html).
    const r = await api.get(DIGEST, { as: staff, headers: { Accept: 'text/html' } });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
  });
});
