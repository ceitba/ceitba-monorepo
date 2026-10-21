// Ports DevLoginIT.java (dev profile + flag) and DevLoginDisabledIT.java (flag only).
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, supports, useServer } from '../support';

const dev = useServer({ env: { SPRING_PROFILES_ACTIVE: 'dev', AUTH_DEV_LOGIN_ENABLED: 'true' } });
const prodLike = useServer({ env: { AUTH_DEV_LOGIN_ENABLED: 'true' } });
const hasDriveUnclaimed = await supports('GET /v1/staff/drive/unclaimed');
const hasDriveInfo = await supports('GET /v1/me/drive/info');

const cookieValue = (setCookies: string[]) => setCookies.find((c) => c.startsWith('ceitba_session='))!.split(';')[0]!.slice('ceitba_session='.length);
const isActiveStaff = async (email: string) => {
  const [r] = await dev.db`SELECT count(*)::int AS n FROM public.ceitba_staff s JOIN public."user" u ON u.id = s.user_id
                           WHERE u.email = ${email} AND s.start <= now() AND s."end" >= now()`;
  return r!.n > 0;
};

describe('DevLoginIT', () => {
  test('signsInWithTheSessionCookieAndOptionallyAsStaff', async () => {
    const res = await dev.post('/v1/auth/dev-login', { body: { email: 'Alumno1@itba.edu.ar', name: 'Alumno Uno', staff: false } });
    expect(res.status).toBe(204);
    const cookie = res.setCookies.find((c) => c.startsWith('ceitba_session='))!;
    expect(cookie).toContain('HttpOnly');
    // application-dev.yml: Secure is off for plain-http localhost.
    expect(cookie).toMatch(/^ceitba_session=[^;]+; Path=\/; Max-Age=86400; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
    const session = cookieValue(res.setCookies);
    const me = await dev.get('/v1/auth/me', { headers: { Cookie: `ceitba_session=${session}` } });
    expect(me.status).toBe(200);
    expect(me.json.email).toBe('alumno1@itba.edu.ar');
    expect(await isActiveStaff('alumno1@itba.edu.ar')).toBe(false);

    const asStaff = await dev.post('/v1/auth/dev-login', { body: { email: 'staff1@itba.edu.ar', staff: true } });
    expect(asStaff.status).toBe(204);
    expect(await isActiveStaff('staff1@itba.edu.ar')).toBe(true);
    if (hasDriveUnclaimed) {
      expect((await dev.get('/v1/staff/drive/unclaimed', { headers: { Cookie: `ceitba_session=${cookieValue(asStaff.setCookies)}` } })).status).toBe(200);
    }
    // Idempotent.
    expect((await dev.post('/v1/auth/dev-login', { body: { email: 'staff1@itba.edu.ar', staff: true } })).status).toBe(204);
    expect((await dev.post('/v1/auth/dev-login', { body: { email: 'someone@gmail.com' } })).status).toBe(400);
  });
});

describe('DevLoginDisabledIT', () => {
  test('devLoginDoesNotExistWithoutTheDevProfile', async () => {
    const body = { email: 'alumno1@itba.edu.ar', staff: true };
    expect((await prodLike.post('/v1/auth/dev-login', { body })).status).toBe(401);
    const authed = await prodLike.post('/v1/auth/dev-login', { body, as: bearer(await mintJwt({ email: 'x@itba.edu.ar' })) });
    expect(authed.status).toBe(404);
    const [r] = await prodLike.db`SELECT count(*)::int AS n FROM public."user" WHERE email = 'alumno1@itba.edu.ar'`;
    expect(r!.n).toBe(0);
  });

  test.skipIf(!hasDriveInfo)('driveEndpointsAnswer503WhenUnconfigured', async () => {
    await prodLike.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
                      ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    const r = await prodLike.get('/v1/me/drive/info', { as: bearer(await mintJwt({ email: 'x@itba.edu.ar' })) });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('DRIVE_SYNC_UNCONFIGURED');
  });
});
