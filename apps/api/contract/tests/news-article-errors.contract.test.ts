// The /v1/articles cases of apps/api/src/test/java/org/ceitba/api/web/HealthAndErrorIT.java
// (wrongMethodReturns405, wrongContentTypeReturns415). The foundation copy in
// health-and-error.contract.test.ts is gated on supports('PUT /v1/articles'), which no
// target ever has, so it is always skipped on ts; these run on both.
import { beforeAll, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer, type As } from '../support';

const api = useServer();
let staff: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

describe('HealthAndErrorIT (articles)', () => {
  test('wrongMethodReturns405', async () => {
    const r = await api.put('/v1/articles', { as: staff });
    expect(r.status).toBe(405);
    expect(new Set(r.headers.get('Allow')!.split(', '))).toEqual(new Set(['GET', 'POST']));
    expect(r.json).toMatchObject({ error: 'MethodNotAllowed', message: "Method 'PUT' is not supported.", path: '/api/v1/articles' });
  });

  test('wrongContentTypeReturns415', async () => {
    const r = await api.post('/v1/articles', { as: staff, body: 'hello', contentType: 'text/plain' });
    expect(r.status).toBe(415);
    expect(r.json.error).toBe('UnsupportedMediaType');
    expect(r.json.message).toBe("Content-Type 'text/plain;charset=UTF-8' is not supported.");
  });
});
