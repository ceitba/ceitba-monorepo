// Ports ReviewLoginDisabledIT.java and ReviewLoginMisconfiguredIT.java (two servers, two configs).
import { describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const disabled = useServer({ env: { REVIEW_LOGIN_EMAIL: 'appreview@example.com', REVIEW_LOGIN_PASSWORD_HASH: '' } });
// What compose produced from an unquoted `$2a$12$<salt+hash>%`.
const misconfigured = useServer({ env: { REVIEW_LOGIN_EMAIL: 'appreview@example.com', REVIEW_LOGIN_PASSWORD_HASH: '$2a$12%' } });

describe('ReviewLoginDisabledIT', () => {
  test('disabledEndpointAnswers404', async () => {
    const r = await disabled.post('/v1/auth/review-login', { body: { email: 'appreview@example.com', password: 'anything' } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: 'NotFound', message: 'Not found', path: '/api/v1/auth/review-login' });
    expect((await disabled.post('/v1/auth/review-login', { body: '{}' })).status).toBe(404);
    expect((await disabled.post('/v1/auth/review-login')).status).toBe(404);
    const [{ n }] = await disabled.db`SELECT count(*)::int AS n FROM public."user"`;
    expect(n).toBe(0);
  });
});

describe('ReviewLoginMisconfiguredIT', () => {
  test('appStartsHealthyAndReviewLoginIsDisabled', async () => {
    const h = await misconfigured.get('/actuator/health');
    expect(h.status).toBe(200);
    expect(h.json.status).toBe('UP');
    const r = await misconfigured.post('/v1/auth/review-login', { body: { email: 'appreview@example.com', password: 'anything' } });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('NotFound');
    const [{ n }] = await misconfigured.db`SELECT count(*)::int AS n FROM public."user"`;
    expect(n).toBe(0);
  });
});
