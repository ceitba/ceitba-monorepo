// Ports apps/api/src/test/java/org/ceitba/api/web/news/ArticleEndpointsIT.java.
// staff() = boss@itba.edu.ar with a real ceitba_staff row; user()/otherUser() = plain JWTs
// (JIT-provisioned on their first @CurrentUser request, like the IT).
import { beforeEach, describe, expect, test } from 'bun:test';
import { apiKey, seedApiKey, seedUser, useServer, type As } from '../support';
import { artToday, as, seedArticle, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
let boss: As;
const user = () => as('user@itba.edu.ar', 'User');
const otherUser = () => as('other@itba.edu.ar', 'Other');

const INDEPENDENT = (extra = '') =>
  `{"id":"ind","title":"T","excerpt":"E","body":[],"category":"Tecnología","authors":["A"]${extra}}`;

async function createIndependent(who?: As): Promise<string> {
  const r = await api.post('/v1/articles', { as: who ?? (await user()), body: INDEPENDENT() });
  expect(r.status).toBe(201);
  expect(r.json.status).toBe('pending_review');
  expect(r.json.id).not.toBe('ind');
  return r.json.id;
}

const ids = (r: { json: any }) => (r.json.data as { id: string }[]).map((a) => a.id);

describe('ArticleEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'it', 'IT', 'IT Branch');
    await seedArticle(api.db, { id: 'a1', title: 'Published', excerpt: 'excerpt', body: ['para1'], category: 'tech', authors: ['Author'], status: 'published' });
    await seedArticle(api.db, { id: 'a2', title: 'Draft Article', excerpt: 'excerpt', body: ['draft para'], category: 'tech', authors: ['Author'], status: 'draft' });
  });

  // -- Public list

  test('publicListShowsOnlyPublished', async () => {
    const r = await api.get('/v1/articles');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].id).toBe('a1');
    expect(r.json.meta.total).toBe(1);
    expect(Object.keys(r.json)).toEqual(['data', 'meta']);
    expect(Object.keys(r.json.meta)).toEqual(['total', 'page', 'limit']);
    expect(Object.keys(r.json.data[0])).toEqual(['id', 'title', 'excerpt', 'body', 'category', 'organization', 'authors',
      'publishedAt', 'readingTime', 'featured', 'colorScheme', 'coverImage', 'status', 'createdAt', 'updatedAt']);
    const a = r.json.data[0];
    expect(a).toMatchObject({ title: 'Published', excerpt: 'excerpt', body: ['para1'], category: 'tech', organization: null,
      authors: ['Author'], publishedAt: null, readingTime: null, featured: false, colorScheme: 'blue', coverImage: null, status: 'published' });
    // Read from the database: OffsetDateTime in UTC.
    expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test('paginationIsStrictWhenCreatedAtTies', async () => {
    for (let i = 0; i < 9; i++) {
      await seedArticle(api.db, { id: `t${i}`, title: `Tied ${i}`, excerpt: 'excerpt', body: ['p'], category: 'tech', authors: ['Author'], status: 'published' });
    }
    await api.db`UPDATE public.articles SET created_at = TIMESTAMPTZ '2026-01-01 12:00:00+00'`;
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await api.get(`/v1/articles?limit=3&page=${page}`);
      expect(r.status).toBe(200);
      seen.push(...ids(r));
    }
    expect(seen).toEqual(['t8', 't7', 't6', 't5', 't4', 't3', 't2', 't1', 't0', 'a1']);
  });

  test('listClampsLimit', async () => {
    const r = await api.get('/v1/articles?limit=0');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.meta.limit).toBe(1);
    const r2 = await api.get('/v1/articles?limit=1000000');
    expect(r2.status).toBe(200);
    expect(r2.json.meta.limit).toBe(100);
    expect(r2.json.meta.page).toBe(1);
  });

  test('staffListCanSeeDrafts', async () => {
    const r = await api.get('/v1/articles?status=draft', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].id).toBe('a2');
  });

  test('staffListWithNullStatusDefaultsToPublished', async () => {
    const r = await api.get('/v1/articles', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
  });

  test('publicListIgnoresDraftStatusParam', async () => {
    const r = await api.get('/v1/articles?status=draft');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].status).toBe('published');
  });

  test('filterByCategoryReturnsMatchingOnly', async () => {
    await seedArticle(api.db, { id: 'a3', title: 'Other', excerpt: 'e', body: [], category: 'events', authors: ['A'], status: 'published' });
    const r = await api.get('/v1/articles?category=tech');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].category).toBe('tech');
  });

  test('paginationMetaIsCorrect', async () => {
    const r = await api.get('/v1/articles?page=1&limit=1');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.meta).toEqual({ total: 1, page: 1, limit: 1 });
  });

  // -- Get one

  test('getPublishedArticleById', async () => {
    const r = await api.get('/v1/articles/a1');
    expect(r.status).toBe(200);
    expect(r.json.id).toBe('a1');
    expect(r.json.title).toBe('Published');
    expect(r.json.body[0]).toBe('para1');
  });

  test('getDraftReturns404ForAnonymous', async () => {
    const r = await api.get('/v1/articles/a2');
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: 'ResourceNotFound', message: "Article with identifier 'a2' not found", path: '/api/v1/articles/a2' });
  });

  test('staffCanGetDraftById', async () => {
    const r = await api.get('/v1/articles/a2', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.id).toBe('a2');
    expect(r.json.status).toBe('draft');
  });

  test('unknownIdReturns404', async () => {
    expect((await api.get('/v1/articles/nope')).status).toBe(404);
  });

  // -- Auth gates on writes

  test('anonymousCannotCreate', async () => {
    const r = await api.post('/v1/articles', { body: '{"title":"T","excerpt":"E","body":[],"category":"Tecnología","authors":["A"]}' });
    expect(r.status).toBe(401);
    expect(r.text).toBe('');
  });

  // -- Independent (org-less) articles by plain users

  test('apiKeyUserManagesOwnIndependentArticle', async () => {
    const keyUser = await seedUser(api.db, 'keyuser@itba.edu.ar', { name: 'Key User' });
    const viaKey = apiKey((await seedApiKey(api.db, keyUser, null, 1)).key);
    const id = await createIndependent(viaKey);
    expect((await api.get(`/v1/articles/${id}`, { as: viaKey })).status).toBe(200);
    expect((await api.get('/v1/articles?mine=true', { as: viaKey })).json.data).toHaveLength(1);
    const p = await api.patch(`/v1/articles/${id}`, { as: viaKey, body: '{"title":"Edited"}' });
    expect(p.status).toBe(200);
    expect(p.json.title).toBe('Edited');
    expect(p.json.status).toBe('pending_review');
    expect((await api.delete(`/v1/articles/${id}`, { as: viaKey })).status).toBe(204);
  });

  test('staffSuppliedIdMustBeASlug', async () => {
    const bad = await api.post('/v1/articles', { as: boss, body: INDEPENDENT().replace('"ind"', '"Bad Id!"') });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'ValidationError',
      message: "Validation failed for field 'id' with value 'Bad Id!': must be 1-100 lowercase letters, digits or '-', starting with a letter or digit" });
    const ok = await api.post('/v1/articles', { as: boss, body: INDEPENDENT() });
    expect(ok.status).toBe(201);
    expect(ok.json.id).toBe('ind');
  });

  test('regularUserCannotCreatePublishedIndependentArticle', async () => {
    const r = await api.post('/v1/articles', { as: await user(), body: INDEPENDENT(',"status":"published"') });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'status' with value 'published': independent articles can only be 'draft' or 'pending_review' until staff publish them");
  });

  test('regularUserCannotCreateForOrgTheyDontBelongTo', async () => {
    const r = await api.post('/v1/articles', { as: await user(), body: INDEPENDENT(',"organization":"it"') });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'AccessDenied', message: 'Insufficient permissions' });
  });

  test('authorEditsOwnPendingArticleUntilStaffPublishIt', async () => {
    const ind = await createIndependent();
    const u = await user();
    const o = await otherUser();
    expect((await api.get(`/v1/articles/${ind}`, { as: u })).status).toBe(200);
    const e = await api.patch(`/v1/articles/${ind}`, { as: u, body: '{"title":"Edited","status":"draft"}' });
    expect(e.status).toBe(200);
    expect(e.json.status).toBe('draft');
    expect((await api.patch(`/v1/articles/${ind}`, { as: u, body: '{"status":"published"}' })).status).toBe(400);
    expect((await api.patch(`/v1/articles/${ind}`, { as: u, body: '{"organization":"it"}' })).status).toBe(403);

    expect((await api.get(`/v1/articles/${ind}`, { as: o })).status).toBe(404);
    expect((await api.patch(`/v1/articles/${ind}`, { as: o, body: '{"title":"Hijacked"}' })).status).toBe(403);
    expect((await api.delete(`/v1/articles/${ind}`, { as: o })).status).toBe(403);

    const pub = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"published"}' });
    expect(pub.status).toBe(200);
    expect(pub.json.status).toBe('published');
    expect((await api.patch(`/v1/articles/${ind}`, { as: u, body: '{"title":"Too late"}' })).status).toBe(403);
    expect((await api.delete(`/v1/articles/${ind}`, { as: u })).status).toBe(403);
  });

  test('undoingAPublishCanClearTheDateItFilledIn', async () => {
    const ind = await createIndependent();
    const r1 = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"published","publishedAt":"2026-10-07"}' });
    expect(r1.status).toBe(200);
    expect(r1.json.publishedAt).toBe('2026-10-07');
    const r2 = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"pending_review","publishedAt":null}' });
    expect(r2.status).toBe(200);
    expect(r2.json.publishedAt).toBe('2026-10-07');
    const r3 = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"pending_review","clearPublishedAt":true}' });
    expect(r3.status).toBe(200);
    expect(r3.json.status).toBe('pending_review');
    const [row] = await api.db`SELECT published_at FROM public.articles WHERE id = ${ind}`;
    expect(row!.published_at).toBeNull();
  });

  test('expectedStatusRefusesAPublishFromAStaleReviewRow', async () => {
    const ind = await createIndependent();
    expect((await api.patch(`/v1/articles/${ind}`, { as: await user(), body: '{"status":"draft"}' })).status).toBe(200);
    const r = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"published","expectedStatus":"pending_review"}' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('InvalidState');
    expect(r.json.message).toBe(`Article ${ind} is draft, not pending_review`);
    const [row] = await api.db`SELECT status FROM public.articles WHERE id = ${ind}`;
    expect(row!.status).toBe('draft');
    const ok = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"published","expectedStatus":"draft"}' });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('published');
  });

  test('publishingAnUndatedArticleDatesItToday', async () => {
    const ind = await createIndependent();
    const [row] = await api.db`SELECT published_at FROM public.articles WHERE id = ${ind}`;
    expect(row!.published_at).toBeNull();
    const r = await api.patch(`/v1/articles/${ind}`, { as: boss, body: '{"status":"published"}' });
    expect(r.status).toBe(200);
    expect(r.json.publishedAt).toBe(artToday());
  });

  test('creatingAnUndatedPublishedArticleDatesItToday', async () => {
    const r = await api.post('/v1/articles', { as: boss, body: INDEPENDENT(',"status":"published"') });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('published');
    expect(r.json.publishedAt).toBe(artToday());
  });

  test('authorCanDeleteOwnPendingArticle', async () => {
    const ind = await createIndependent();
    expect((await api.delete(`/v1/articles/${ind}`, { as: await user() })).status).toBe(204);
  });

  test('mineListsOwnArticlesOfEveryStatus', async () => {
    const ind = await createIndependent();
    const [u] = await api.db`SELECT id FROM public."user" WHERE email = 'user@itba.edu.ar'`;
    await seedArticle(api.db, { id: 'org-art', title: 'Org', excerpt: 'E', body: [], category: 'tech', authors: ['A'], status: 'draft', organization: 'it', createdBy: u!.id });
    const me = await user();
    expect((await api.get('/v1/articles/org-art', { as: me })).status).toBe(404);

    const r = await api.get('/v1/articles?mine=true', { as: me });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].id).toBe(ind);
    expect(r.json.data[0].status).toBe('pending_review');
    const r2 = await api.get('/v1/articles?mine=true&organization=it', { as: me });
    expect(r2.json.data).toHaveLength(1);
    expect(r2.json.data[0].id).toBe(ind);
    expect((await api.get('/v1/articles?mine=true&status=draft', { as: me })).json.data).toHaveLength(0);
    expect((await api.get('/v1/articles?mine=true', { as: boss })).json.data).toHaveLength(0);
    const anon = await api.get('/v1/articles?mine=true');
    expect(anon.status).toBe(200);
    expect(anon.json.data).toHaveLength(0);
    expect(anon.text).toBe('{"data":[],"meta":{"total":0,"page":1,"limit":20}}');
    expect((await api.get('/v1/articles')).json.data).toHaveLength(1);
  });

  // -- Staff CRUD

  test('staffCanCreateArticle', async () => {
    const r = await api.post('/v1/articles', { as: boss, body: `{"title":"New Article","excerpt":"Ex","body":["p1","p2"],
       "category":"Tecnología","authors":["Staff","Co-author"],"status":"published","colorScheme":"blue"}` });
    expect(r.status).toBe(201);
    expect(r.json.title).toBe('New Article');
    expect(r.json.body).toEqual(['p1', 'p2']);
    expect(r.json.status).toBe('published');
    expect(r.json.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Computed in Java (OffsetDateTime.now() in the JVM zone).
    expect(r.json.createdAt).toMatch(/-03:00$/);
    expect(r.json.updatedAt).toMatch(/-03:00$/);
  });

  test('staffCanCreateDraft', async () => {
    const r = await api.post('/v1/articles', { as: boss, body: '{"title":"Draft","excerpt":"E","body":[],"category":"Tecnología","authors":["A"],"status":"draft"}' });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('draft');
  });

  test('staffCanPatchTitle', async () => {
    const r = await api.patch('/v1/articles/a1', { as: boss, body: '{"title":"Updated Title"}' });
    expect(r.status).toBe(200);
    expect(r.json.title).toBe('Updated Title');
    expect(r.json.excerpt).toBe('excerpt');
    // created_at read from the row, updated_at written by @UpdateTimestamp.
    expect(r.json.createdAt).toMatch(/Z$/);
    expect(r.json.updatedAt).toMatch(/-03:00$/);
  });

  test('patchWithoutFeaturedKeepsItFeatured', async () => {
    await api.db`UPDATE public.articles SET featured = true WHERE id = 'a1'`;
    const r = await api.patch('/v1/articles/a1', { as: boss, body: '{"title":"Retitled"}' });
    expect(r.status).toBe(200);
    expect(r.json.featured).toBe(true);
    const r2 = await api.patch('/v1/articles/a1', { as: boss, body: '{"featured":false}' });
    expect(r2.status).toBe(200);
    expect(r2.json.featured).toBe(false);
  });

  test('staffCanPromoteDraftToPublished', async () => {
    const r = await api.patch('/v1/articles/a2', { as: boss, body: '{"status":"published"}' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('published');
    expect((await api.get('/v1/articles/a2')).status).toBe(200);
  });

  test('patchUnknownIdReturns404', async () => {
    expect((await api.patch('/v1/articles/nope', { as: boss, body: '{"title":"x"}' })).status).toBe(404);
  });

  test('staffCanDelete', async () => {
    const r = await api.delete('/v1/articles/a1', { as: boss });
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    expect((await api.get('/v1/articles/a1')).status).toBe(404);
  });

  test('deleteUnknownReturns404', async () => {
    expect((await api.delete('/v1/articles/nope', { as: boss })).status).toBe(404);
  });

  test('createValidationFailsOnMissingTitle', async () => {
    const r = await api.post('/v1/articles', { as: boss, body: '{"title":"","excerpt":"E","body":[],"category":"Tecnología","authors":["A"]}' });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'ValidationError', message: 'title: must not be blank' });
  });
});
