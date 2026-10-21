// Ports apps/api/src/test/java/org/ceitba/api/web/news/NewsDraftsAndCategoriesIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer, type As } from '../support';
import { as, seedArticle, seedMembership, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
let boss: As;
const member = () => as('alice@itba.edu.ar', 'Alice');
const outsider = () => as('bob@itba.edu.ar', 'Bob');
const ids = (r: { json: any }) => (r.json.data as { id: string }[]).map((a) => a.id).sort();

async function article(id: string, org: string | null, status: string, category: string) {
  await seedArticle(api.db, { id, title: id, excerpt: 'x', body: ['p'], category, authors: ['A'], status, organization: org });
}

describe('NewsDraftsAndCategoriesIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(api.db, 'trama', 'TRAMA', 'TRAMA ITBA');
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    await seedMembership(api.db, alice, 'sabf', 'member');
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await article('sabf-pub', 'sabf', 'published', 'Académico');
    await article('sabf-draft', 'sabf', 'draft', 'Académico');
    await article('trama-pub', 'trama', 'published', 'Cultura');
    await article('trama-draft', 'trama', 'draft', 'Cultura');
    await article('legacy', null, 'published', 'ACADÉMICO');
  });

  test('staffStatusAllListsDraftsAndPublished', async () => {
    const r = await api.get('/v1/articles?status=all&limit=100', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.meta.total).toBe(5);
    expect(ids(r)).toEqual(['legacy', 'sabf-draft', 'sabf-pub', 'trama-draft', 'trama-pub']);
  });

  test('staffWithoutStatusStillGetsPublishedOnly', async () => {
    const r = await api.get('/v1/articles', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.meta.total).toBe(3);
  });

  test('anonymousStatusAllOrDraftGetsPublishedOnly', async () => {
    for (const s of ['all', 'draft']) {
      const r = await api.get(`/v1/articles?status=${s}`);
      expect(r.status).toBe(200);
      expect(r.json.meta.total).toBe(3);
      expect(ids(r)).toEqual(['legacy', 'sabf-pub', 'trama-pub']);
    }
    expect(ids(await api.get('/v1/articles?organization=sabf&status=all'))).toEqual(['sabf-pub']);
  });

  test('outsiderStatusAllGetsPublishedOnly', async () => {
    const o = await outsider();
    expect((await api.get('/v1/articles?status=all', { as: o })).json.meta.total).toBe(3);
    expect(ids(await api.get('/v1/articles?organization=sabf&status=all', { as: o }))).toEqual(['sabf-pub']);
  });

  test('memberListsOwnOrgDrafts', async () => {
    const m = await member();
    const r = await api.get('/v1/articles?organization=sabf&status=all', { as: m });
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(['sabf-draft', 'sabf-pub']);
    expect(ids(await api.get('/v1/articles?organization=sabf&status=draft', { as: m }))).toEqual(['sabf-draft']);
    expect(ids(await api.get('/v1/articles?organization=sabf', { as: m }))).toEqual(['sabf-pub']);
  });

  test('memberDoesNotSeeOtherOrgDrafts', async () => {
    const m = await member();
    expect(ids(await api.get('/v1/articles?organization=trama&status=all', { as: m }))).toEqual(['trama-pub']);
    expect((await api.get('/v1/articles?status=all', { as: m })).json.meta.total).toBe(3);
  });

  test('memberGetsOwnOrgDraftById', async () => {
    const r = await api.get('/v1/articles/sabf-draft', { as: await member() });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('draft');
    expect(r.json.organization).toBe('sabf');
  });

  test('draftByIdIsHiddenFromEveryoneElse', async () => {
    expect((await api.get('/v1/articles/trama-draft', { as: await member() })).status).toBe(404);
    expect((await api.get('/v1/articles/sabf-draft', { as: await outsider() })).status).toBe(404);
    expect((await api.get('/v1/articles/sabf-draft')).status).toBe(404);
    expect((await api.get('/v1/articles/sabf-draft', { as: boss })).status).toBe(200);
  });

  test('createWithNonCanonicalCategoryIs400', async () => {
    for (const c of ['ACADÉMICO', 'academico', 'Todos', '']) {
      const r = await api.post('/v1/articles', { as: boss, body: `{"title":"T","excerpt":"E","body":[],"category":"${c}","authors":["A"]}` });
      expect(r.status).toBe(400);
      expect(r.json.message).toContain('category');
    }
    const one = await api.post('/v1/articles', { as: boss, body: '{"title":"T","excerpt":"E","body":[],"category":"Todos","authors":["A"]}' });
    expect(one.json.message).toBe('category: must be one of Académico, Campus, Cultura, Deportes, Tecnología, Organizaciones, General');
    const r = await api.post('/v1/news/events', { as: boss, body: `{"title":"T","eventDate":"2026-08-01","startTime":"10:00","endTime":"12:00",
       "location":"L","category":"DEPORTES"}` });
    expect(r.status).toBe(400);
    expect(r.json.message).toContain('must be one of');
  });

  test('createWithCanonicalCategorySucceeds', async () => {
    const r = await api.post('/v1/articles', { as: boss, body: '{"title":"T","excerpt":"E","body":[],"category":"Tecnología","authors":["A"]}' });
    expect(r.status).toBe(201);
    expect(r.json.category).toBe('Tecnología');
  });

  test('patchWithNonCanonicalCategoryIs400', async () => {
    expect((await api.patch('/v1/articles/sabf-pub', { as: boss, body: '{"category":"DEPORTES"}' })).status).toBe(400);
    const r = await api.patch('/v1/articles/sabf-pub', { as: boss, body: '{"category":"Deportes"}' });
    expect(r.status).toBe(200);
    expect(r.json.category).toBe('Deportes');
  });

  test('categoryFilterIsExact', async () => {
    expect(ids(await api.get(`/v1/articles?category=${encodeURIComponent('Académico')}`))).toEqual(['sabf-pub']);
    expect((await api.get('/v1/articles?category=academico')).json.meta.total).toBe(0);
  });

  test('organizationUrlsMustBeHttp', async () => {
    const r1 = await api.post('/v1/organizations', { as: boss, body: '{"slug":"x","name":"X","fullName":"X Org","logoUrl":"javascript:alert(1)"}' });
    expect(r1.status).toBe(400);
    expect(r1.json.message).toContain('logoUrl');
    const m = await member();
    const r2 = await api.patch('/v1/organizations/sabf', { as: m, body: '{"backgroundUrl":"javascript:alert(1)"}' });
    expect(r2.status).toBe(400);
    expect(r2.json.message).toBe('backgroundUrl: must be an http(s) URL');
    expect((await api.patch('/v1/organizations/sabf', { as: boss, body: `{"logoUrl":"https://x.test/${'a'.repeat(2048)}"}` })).status).toBe(400);
    const r4 = await api.patch('/v1/organizations/sabf', { as: m, body: '{"logoUrl":"https://x.test/l.png","backgroundUrl":""}' });
    expect(r4.status).toBe(200);
    expect(r4.json.logoUrl).toBe('https://x.test/l.png');
    expect(r4.json.backgroundUrl).toBe('');
  });
});
