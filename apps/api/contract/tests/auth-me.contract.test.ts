// Ports apps/api/src/test/java/org/ceitba/api/web/auth/AuthMeIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, revokeModerator, seedCareer, seedModerator, seedUser, truncateUsers, useServer } from '../support';

const api = useServer();
let aliceId: string;
const aliceJwt = async () => bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));

describe('AuthMeIT', () => {
  beforeEach(async () => {
    await truncateUsers(api.db);
    await api.db`DELETE FROM public.plan`;
    await api.db`DELETE FROM public.careers`;
    await seedCareer(api.db, 'S', 'Ingeniería en Informática');
    aliceId = await seedUser(api.db, 'alice@itba.edu.ar', {
      name: 'Alice', avatarUrl: 'https://example.com/avatar.jpg', careerId: 'S', plan: 'S10-Rev23', fileNumber: 61234,
      linkedin: 'alice-doe', instagram: 'alice.doe', discord: 'alice_doe',
    });
  });

  test('meIncludesAcademicAndSocialProfile', async () => {
    const r = await api.get('/v1/auth/me', { as: await aliceJwt() });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ careerId: 'S', plan: 'S10-Rev23', fileNumber: 61234, linkedin: 'alice-doe', instagram: 'alice.doe', discord: 'alice_doe' });
  });

  test('meModeratorFlagFollowsActiveGrant', async () => {
    expect((await api.get('/v1/auth/me', { as: await aliceJwt() })).json.moderator).toBe(false);
    await seedModerator(api.db, aliceId);
    const granted = await api.get('/v1/auth/me', { as: await aliceJwt() });
    expect(granted.json.moderator).toBe(true);
    expect(granted.json.role).toBe('user');
    await revokeModerator(api.db, aliceId);
    expect((await api.get('/v1/auth/me', { as: await aliceJwt() })).json.moderator).toBe(false);
  });

  test('meRequiresAuthentication', async () => {
    expect((await api.get('/v1/auth/me')).status).toBe(401);
  });

  test('meReturnsUserProfile', async () => {
    const r = await api.get('/v1/auth/me', { as: await aliceJwt() });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: 'alice@itba.edu.ar', name: 'Alice', role: 'user', avatarUrl: 'https://example.com/avatar.jpg' });
    expect(r.json.id).toBe(aliceId);
    // The full shape and key order (UserMeResponse record).
    expect(Object.keys(r.json)).toEqual(['id', 'name', 'email', 'role', 'moderator', 'avatarUrl', 'theme', 'language', 'careerId',
      'plan', 'fileNumber', 'linkedin', 'instagram', 'discord', 'organizations', 'follows', 'capabilities', 'apiKeyScopes']);
    expect(r.json.apiKeyScopes).toBeNull();
  });

  test('meCreatesUserIfFirstLogin', async () => {
    const r = await api.get('/v1/auth/me', { as: bearer(await mintJwt({ email: 'bob@itba.edu.ar', name: 'Bob' })) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: 'bob@itba.edu.ar', name: 'Bob', role: 'user', moderator: false });
    // The IT's jsonPath(...).doesNotExist() also holds for JSON nulls.
    expect(r.json.careerId ?? undefined).toBeUndefined();
    expect(r.json.linkedin ?? undefined).toBeUndefined();
    // JIT row: Hibernate inserts NULL preferred_language (not the column default 'es').
    const [row] = await api.db`SELECT preferred_language, theme, digest_email_enabled FROM public."user" WHERE email = 'bob@itba.edu.ar'`;
    expect(row).toEqual({ preferred_language: null, theme: null, digest_email_enabled: true });
  });

  test('meIncludesEmptyOrganizationsByDefault', async () => {
    const r = await api.get('/v1/auth/me', { as: await aliceJwt() });
    expect(r.json.organizations).toEqual([]);
    expect(Array.isArray(r.json.follows)).toBe(true);
  });

  test('meRoleIsUserWithoutActiveCeitbaStaffRow', async () => {
    // The IT claims ROLE_STAFF as a mock authority; with real tokens there is no such thing: the DB decides.
    expect((await api.get('/v1/auth/me', { as: await aliceJwt() })).json.role).toBe('user');
  });
});
