// Not in the Java suite: the blue/green overlap of the cutover (and of a
// rollback). For a few seconds the Java jar and the Bun server run side by side
// on ONE database, so a session or refresh token issued by either must work on
// the other. Both servers here share the Java server's database
// (shareDatabaseWith), the real overlap condition. Token *signing* parity on
// separate databases is cross-signing.contract.test.ts; the job locks (no jar
// needed) are test/jobs/joblock-cross-runtime.test.ts.
// Needs a Java jar (CONTRACT_JAR, built from the last Java commit): skipped without it. Green on
// the jar of the cutover commit.
import { describe, expect, test } from 'bun:test';
import bcrypt from 'bcryptjs';
import { bearer, sessionCookie, useServer } from '../support';
import { JAVA_AVAILABLE } from '../support/server';

const run = JAVA_AVAILABLE && process.env.CONTRACT_SKIP_CROSS !== '1';
const EMAIL = 'appreview@example.com';
const env = { REVIEW_LOGIN_EMAIL: EMAIL, REVIEW_LOGIN_PASSWORD_HASH: bcrypt.hashSync('pw', 4) };
const java = run ? useServer({ target: 'java', env }) : null;
const ts = run ? useServer({ target: 'ts', env, shareDatabaseWith: () => java! }) : null;

const login = async (s: NonNullable<typeof java>) => {
  const r = await s.post('/v1/auth/review-login', { body: { email: EMAIL, password: 'pw' } });
  expect(r.status).toBe(200);
  return r.json as { accessToken: string; refreshToken: string };
};
const refresh = (s: NonNullable<typeof java>, token: string) => s.post('/v1/auth/refresh', { body: { refreshToken: token } });

describe.skipIf(!run)('cross-runtime (one database)', () => {
  test('bothServersShareTheDatabase', async () => {
    expect(ts!.dbName).toBe(java!.dbName);
  });

  test('aJavaSessionWorksOnBunAndTheReverse_bearerAndCookie', async () => {
    const fromJava = await login(java!);
    const fromTs = await login(ts!);
    for (const [server, token] of [[ts!, fromJava.accessToken], [java!, fromTs.accessToken]] as const) {
      const viaBearer = await server.get('/v1/auth/me', { as: bearer(token) });
      expect(viaBearer.status).toBe(200);
      expect(viaBearer.json.email).toBe(EMAIL);
      // The web app's HttpOnly session cookie carries the same JWT.
      const viaCookie = await server.get('/v1/auth/me', { as: sessionCookie(token) });
      expect(viaCookie.status).toBe(200);
      expect(viaCookie.json.email).toBe(EMAIL);
    }
  });

  test('aJavaRefreshTokenRefreshesOnBunAndTheChainContinuesOnJava', async () => {
    const t1 = (await login(java!)).refreshToken;
    const onTs = await refresh(ts!, t1);
    expect(onTs.status).toBe(200);
    expect(onTs.json.user.email).toBe(EMAIL);
    const t2 = onTs.json.refreshToken as string;
    // The rotated token Bun issued refreshes on Java (a rollback mid-session).
    const onJava = await refresh(java!, t2);
    expect(onJava.status).toBe(200);
    const t3 = onJava.json.refreshToken as string;
    // Both access tokens are accepted by the other runtime.
    expect((await java!.get('/v1/auth/me', { as: bearer(onTs.json.accessToken) })).status).toBe(200);
    expect((await ts!.get('/v1/auth/me', { as: bearer(onJava.json.accessToken) })).status).toBe(200);
    // One family across both runtimes: the rows Java and Bun wrote chain together.
    const rows = await java!.db`SELECT family_id, revoked_at, replaced_by FROM public.refresh_tokens
      WHERE family_id = (SELECT family_id FROM public.refresh_tokens WHERE replaced_by IS NOT NULL ORDER BY created_at DESC LIMIT 1)`;
    expect(rows.length).toBe(3);
    // Reuse detection crosses runtimes too: after the grace window, replaying
    // t1 (rotated by Bun) on Java revokes the family, and Bun refuses t3.
    await java!.db`UPDATE public.refresh_tokens SET revoked_at = revoked_at - INTERVAL '10 minutes' WHERE revoked_at IS NOT NULL`;
    expect((await refresh(java!, t1)).status).toBe(401);
    expect((await refresh(ts!, t3)).status).toBe(401);
  });

  test('aBunRefreshTokenRefreshesOnJava', async () => {
    const t1 = (await login(ts!)).refreshToken;
    const r = await refresh(java!, t1);
    expect(r.status).toBe(200);
    expect(r.json.user.email).toBe(EMAIL);
  });
});
