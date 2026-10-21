// Ports apps/api/src/test/java/org/ceitba/api/web/news/FollowEndpointsIT.java.
// /v1/me/follows is web/user/MeFollowsController (another feature; backed by the news
// FollowService): skipped on ts until that route lands.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, supports, useServer } from '../support';
import { as, seedFollow, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
const hasFollows = await supports('GET /v1/me/follows', 'POST /v1/me/follows/{slug}', 'DELETE /v1/me/follows/{slug}');
const hasAuthMe = await supports('GET /v1/auth/me');
const user = () => as('alice@itba.edu.ar', 'Alice');

describe('FollowEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes del ITBA');
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
  });

  test('anonymousCannotListFollows', async () => {
    expect((await api.get('/v1/me/follows')).status).toBe(401);
  });

  test.skipIf(!hasAuthMe)('firstLoginAutoFollowsCeitba', async () => {
    const r = await api.get('/v1/auth/me', { as: await as('bob@itba.edu.ar', 'Bob') });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.follows)).toBe(true);
    expect(r.json.follows[0]).toBe('ceitba');
  });

  test.skipIf(!hasFollows)('followAndListReturnsRow', async () => {
    const u = await user();
    const f = await api.post('/v1/me/follows/sabf', { as: u });
    expect(f.status).toBe(201);
    expect(f.json.orgSlug).toBe('sabf');
    const r = await api.get('/v1/me/follows', { as: u });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);
    expect(r.json[0].orgSlug).toBe('sabf');
  });

  test.skipIf(!hasFollows)('unfollowRemovesRow', async () => {
    const [alice] = await api.db`SELECT id FROM public."user" WHERE email = 'alice@itba.edu.ar'`;
    await seedFollow(api.db, alice!.id, 'ceitba');
    await seedFollow(api.db, alice!.id, 'sabf');
    const u = await user();
    expect((await api.delete('/v1/me/follows/ceitba', { as: u })).status).toBe(204);
    const r = await api.get('/v1/me/follows', { as: u });
    expect(r.json).toHaveLength(1);
    expect(r.json[0].orgSlug).toBe('sabf');
  });

  test.skipIf(!hasFollows)('followUnknownOrgReturns404', async () => {
    expect((await api.post('/v1/me/follows/no-such-org', { as: await user() })).status).toBe(404);
  });

  test.skipIf(!hasFollows)('followIsIdempotent', async () => {
    const u = await user();
    expect((await api.post('/v1/me/follows/sabf', { as: u })).status).toBe(201);
    expect((await api.post('/v1/me/follows/sabf', { as: u })).status).toBe(201);
    expect((await api.get('/v1/me/follows', { as: u })).json).toHaveLength(1);
  });
});
