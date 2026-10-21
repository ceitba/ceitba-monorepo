// Ports apps/api/src/test/java/org/ceitba/api/web/news/OrganizationEndpointsIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer, type As } from '../support';
import { as, seedFollow, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
let boss: As;
const user = () => as('user@itba.edu.ar', 'User');

describe('OrganizationEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'it', 'IT', 'IT Branch', { description: 'The tech branch', category: 'tech' });
    await seedOrg(api.db, 'media', 'Media', 'Media Branch');
  });

  test('listReturnsAllOrgs', async () => {
    const r = await api.get('/v1/organizations');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(2);
    expect(Object.keys(r.json)).toEqual(['data']);
  });

  test('getBySlugReturnsCorrectOrg', async () => {
    const r = await api.get('/v1/organizations/it');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"slug":"it","name":"IT","fullName":"IT Branch","description":"The tech branch","category":"tech","color":null,'
      + '"followerCount":0,"logoUrl":null,"backgroundUrl":null,"instagram":null,"linkedinUrl":null,"websiteUrl":null,"contactEmail":null,'
      + '"recruitingOpen":false,"recruitingUrl":null,"recruitingText":null,"attendeesVisibleToMembers":true,"board":[]}');
    const list = await api.get('/v1/organizations');
    const it = list.json.data.find((o: { slug: string }) => o.slug === 'it');
    expect(it.board).toBeNull();
  });

  test('getByUnknownSlugReturns404', async () => {
    const r = await api.get('/v1/organizations/nope');
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Organization with identifier 'nope' not found");
  });

  test('anonymousCannotCreate', async () => {
    expect((await api.post('/v1/organizations', { body: '{"slug":"new","name":"New","fullName":"New Branch"}' })).status).toBe(401);
  });

  test('regularUserCannotCreate', async () => {
    expect((await api.post('/v1/organizations', { as: await user(), body: '{"slug":"new","name":"New","fullName":"New Branch"}' })).status).toBe(403);
  });

  test('staffCanCreate', async () => {
    const r = await api.post('/v1/organizations', { as: boss, body: '{"slug":"nautical","name":"Nautical","fullName":"Nautical Branch","instagram":"@Nautical.Club","contactEmail":"n@itba.edu.ar","recruitingUrl":"  ","recruitingText":"  Sumate  "}' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ slug: 'nautical', name: 'Nautical', followerCount: 0, board: null });
    expect(r.json.instagram).toBe('nautical.club');
    expect(r.json.contactEmail).toBe('n@itba.edu.ar');
    expect(r.json.recruitingUrl).toBeNull();
    expect(r.json.recruitingText).toBe('Sumate');
  });

  test('duplicateSlugReturns409', async () => {
    const r = await api.post('/v1/organizations', { as: boss, body: '{"slug":"it","name":"IT v2","fullName":"IT Branch v2"}' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
    expect(r.json.message).toBe("Organization with identifier 'it' already exists");
  });

  test('createRejectsMalformedSlugs', async () => {
    for (const slug of ['Upper', 'with space', 'acentó', '-lead', 'trail-', 'double--hyphen', 'under_score', 'a', 'x'.repeat(41)]) {
      const r = await api.post('/v1/organizations', { as: boss, body: `{"slug":"${slug}","name":"N","fullName":"N B"}` });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('ValidationError');
      expect(r.json.message.startsWith('slug: ')).toBe(true);
    }
    const one = await api.post('/v1/organizations', { as: boss, body: '{"slug":"Upper","name":"N","fullName":"N B"}' });
    expect(one.json.message).toBe('slug: must use only lowercase letters, digits and single hyphens between them');
  });

  test('createAcceptsKebabCaseSlugAtBounds', async () => {
    for (const slug of ['ab', 'computer-society-2', 'x'.repeat(40)]) {
      expect((await api.post('/v1/organizations', { as: boss, body: `{"slug":"${slug}","name":"N","fullName":"N B"}` })).status).toBe(201);
    }
  });

  test('staffCanPatch', async () => {
    const r = await api.patch('/v1/organizations/it', { as: boss, body: '{"name":"IT Updated","fullName":"IT Branch Updated"}' });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe('IT Updated');
    expect(r.json.board).toBeNull();
  });

  test('patchIgnoresSlugInBody', async () => {
    const r = await api.patch('/v1/organizations/it', { as: boss, body: '{"slug":"Not A Slug","name":"IT Renamed"}' });
    expect(r.status).toBe(200);
    expect(r.json.slug).toBe('it');
    expect(r.json.name).toBe('IT Renamed');
    expect((await api.get('/v1/organizations/it')).json.name).toBe('IT Renamed');
  });

  test('staffCanPatchProfileFields', async () => {
    const r = await api.patch('/v1/organizations/it', { as: boss, body: '{"description":"updated","logoUrl":"https://x/l.png","backgroundUrl":"https://x/bg.png"}' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ description: 'updated', logoUrl: 'https://x/l.png', backgroundUrl: 'https://x/bg.png', name: 'IT', fullName: 'IT Branch' });
    const g = await api.get('/v1/organizations/it');
    expect(g.json.name).toBe('IT');
    expect(g.json.fullName).toBe('IT Branch');
  });

  test('followerCountIsLive', async () => {
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await seedFollow(api.db, alice, 'it');
    await seedFollow(api.db, bob, 'it');
    expect((await api.get('/v1/organizations/it')).json.followerCount).toBe(2);
    expect((await api.get('/v1/organizations/media')).json.followerCount).toBe(0);
  });

  // The list counts each org's followers (one grouped query, not one per org).
  test('listCarriesEachOrgsFollowerCount', async () => {
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await seedFollow(api.db, alice, 'it');
    await seedFollow(api.db, bob, 'it');
    await seedFollow(api.db, bob, 'media');
    const r = await api.get('/v1/organizations');
    const counts = Object.fromEntries((r.json.data as { slug: string; followerCount: number }[]).map((o) => [o.slug, o.followerCount]));
    expect(counts).toEqual({ it: 2, media: 1 });
    expect(r.json.data.every((o: { board: unknown }) => o.board === null)).toBe(true);
  });

  test('regularUserCannotPatch', async () => {
    expect((await api.patch('/v1/organizations/it', { as: await user(), body: '{"description":"x"}' })).status).toBe(403);
  });

  test('patchUnknownSlugReturns404', async () => {
    expect((await api.patch('/v1/organizations/nope', { as: boss, body: '{"name":"x","fullName":"x"}' })).status).toBe(404);
  });

  test('staffCanDelete', async () => {
    expect((await api.delete('/v1/organizations/media', { as: boss })).status).toBe(204);
    expect((await api.get('/v1/organizations/media')).status).toBe(404);
  });

  test('deleteUnknownReturns404', async () => {
    expect((await api.delete('/v1/organizations/nope', { as: boss })).status).toBe(404);
  });

  // Not in the IT: the followers panel's shape (Map.of: key order not stable in Java).
  test('followersListShape', async () => {
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice', avatarUrl: 'https://a/x.png' });
    await seedFollow(api.db, alice, 'it');
    const r = await api.get('/v1/organizations/it/followers', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(1);
    expect(Object.keys(r.json.data[0])).toEqual(['userId', 'name', 'email', 'avatarUrl', 'followedAt']);
    expect(r.json.data[0]).toMatchObject({ userId: alice, name: 'Alice', email: 'alice@itba.edu.ar', avatarUrl: 'https://a/x.png' });
    expect(r.json.data[0].followedAt).toMatch(/Z$/);
    const missing = await api.get('/v1/organizations/nope/followers', { as: boss });
    expect(missing.status).toBe(404);
  });
});
