// Article comments (docs/NEWSLETTER-ENGAGEMENT.md "Comments"): threads, replies, likes,
// reports, moderation and access.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer } from '../support';
import { as, seedArticle, seedMembership, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

const reader = () => as('reader@itba.edu.ar', 'Reader');
const editor = () => as('editor@itba.edu.ar', 'Editor');
const path = (rest = '') => `/v1/articles/c-art/comments${rest}`;

async function post(body: unknown, who = reader) {
  return api.post(path(), { as: await who(), body });
}

describe('ArticleComments', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'robotica', 'Robótica', 'Club de Robótica');
    await seedArticle(api.db, { id: 'c-art', title: 'T', excerpt: 'e', body: [], category: 'tech', authors: ['A'], organization: 'robotica' });
    await seedArticle(api.db, { id: 'c-draft', title: 'D', excerpt: 'e', body: [], category: 'tech', authors: ['A'], organization: 'robotica', status: 'draft' });
    const editorId = await seedUser(api.db, 'editor@itba.edu.ar', { name: 'Editor' });
    await seedMembership(api.db, editorId, 'robotica', 'member');
    await seedUser(api.db, 'reader@itba.edu.ar', { name: 'Reader' });
  });

  test('emptyThreadIsPublic', async () => {
    const r = await api.get(path());
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"enabled":true,"canModerate":false,"total":0,"comments":[]}');
  });

  test('anonymousCannotComment', async () => {
    const r = await api.post(path(), { body: { body: 'hola' } });
    expect(r.status).toBe(401);
  });

  test('createReturnsTheCommentWithItsShape', async () => {
    const r = await post({ body: '  Muy buena nota  ' });
    expect(r.status).toBe(201);
    const c = r.json;
    expect(Object.keys(c)).toEqual(['id', 'parentId', 'authorName', 'authorAvatarUrl', 'authorRole', 'body', 'createdAt', 'likes', 'likedByMe', 'mine', 'pinned', 'deleted', 'hidden', 'replies']);
    expect(c).toMatchObject({ parentId: null, authorName: 'Reader', authorRole: null, body: 'Muy buena nota', likes: 0, likedByMe: false, mine: true, pinned: false, deleted: false, hidden: false, replies: [] });
    expect(c.createdAt).toMatch(/Z$/);
  });

  test('blankOrTooLongBodyIs400', async () => {
    expect((await post({ body: '   ' })).status).toBe(400);
    expect((await post({ body: 'x'.repeat(1001) })).status).toBe(400);
  });

  test('orgMemberIsMarkedAsAuthorAndRepliesNestOneLevel', async () => {
    const top = (await post({ body: 'pregunta' })).json;
    const reply = await post({ body: 'respuesta', parentId: top.id }, editor);
    expect(reply.status).toBe(201);
    expect(reply.json.authorRole).toBe('author');
    // A reply to a reply is refused.
    expect((await post({ body: 'x', parentId: reply.json.id })).status).toBe(400);
    // A parent from elsewhere is refused.
    expect((await post({ body: 'x', parentId: crypto.randomUUID() })).status).toBe(400);

    const t = (await api.get(path())).json;
    expect(t.total).toBe(2);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].replies.map((x: { body: string }) => x.body)).toEqual(['respuesta']);
    expect(t.comments[0].mine).toBe(false);
  });

  test('sortTopOrdersByLikesAndPinnedFirst', async () => {
    const a = (await post({ body: 'a' })).json;
    const b = (await post({ body: 'b' })).json;
    const c = (await post({ body: 'c' })).json;
    expect((await api.put(path(`/${a.id}/like`), { as: await editor() })).json).toEqual({ likes: 1, likedByMe: true });
    const order = async (sort: string) => (await api.get(path(), { query: { sort } })).json.comments.map((x: { body: string }) => x.body);
    expect(await order('top')).toEqual(['a', 'c', 'b']);
    expect(await order('new')).toEqual(['c', 'b', 'a']);
    expect((await api.put(path(`/${b.id}/pin`), { as: await editor(), body: { pinned: true } })).json.pinned).toBe(true);
    // Pinning another one unpins the first.
    await api.put(path(`/${c.id}/pin`), { as: await editor(), body: { pinned: true } });
    expect(await order('top')).toEqual(['c', 'a', 'b']);
    expect((await api.get(path(), { query: { sort: 'old' } })).status).toBe(400);
  });

  test('likesAreIdempotentPerUser', async () => {
    const c = (await post({ body: 'a' })).json;
    await api.put(path(`/${c.id}/like`), { as: await reader() });
    expect((await api.put(path(`/${c.id}/like`), { as: await reader() })).json).toEqual({ likes: 1, likedByMe: true });
    expect((await api.delete(path(`/${c.id}/like`), { as: await reader() })).json).toEqual({ likes: 0, likedByMe: false });
    expect((await api.get(path(), { as: await reader() })).json.comments[0].likedByMe).toBe(false);
  });

  test('onlyTheAuthorOrAnEditorDeletes_tombstoneKeepsReplies', async () => {
    const top = (await post({ body: 'top' })).json;
    await post({ body: 'reply', parentId: top.id }, editor);
    const other = await as('other@itba.edu.ar', 'Other');
    expect((await api.delete(path(`/${top.id}`), { as: other })).status).toBe(403);
    expect((await api.delete(path(`/${top.id}`), { as: await reader() })).status).toBe(204);
    const t = (await api.get(path())).json;
    expect(t.total).toBe(1);
    expect(t.comments[0]).toMatchObject({ deleted: true, body: '', authorName: null });
    expect(t.comments[0].replies).toHaveLength(1);
    // Already deleted -> 404.
    expect((await api.delete(path(`/${top.id}`), { as: await reader() })).status).toBe(404);
    // An editor deletes anyone's comment; a lone deleted comment leaves the list.
    const lone = (await post({ body: 'lone' })).json;
    expect((await api.delete(path(`/${lone.id}`), { as: await editor() })).status).toBe(204);
    expect((await api.get(path())).json.comments).toHaveLength(1);
  });

  test('threeReportsHideUntilAnEditorRestores', async () => {
    const c = (await post({ body: 'spam' })).json;
    for (const e of ['r1', 'r2']) expect((await api.put(path(`/${c.id}/report`), { as: await as(`${e}@itba.edu.ar`), body: { reason: 'spam' } })).status).toBe(204);
    // The same user reporting again does not count twice.
    await api.put(path(`/${c.id}/report`), { as: await as('r2@itba.edu.ar'), body: {} });
    expect((await api.get(path())).json.total).toBe(1);
    await api.put(path(`/${c.id}/report`), { as: await as('r3@itba.edu.ar'), body: {} });
    expect((await api.get(path())).json.comments).toEqual([]);
    const forEditor = (await api.get(path(), { as: await editor() })).json;
    expect(forEditor.canModerate).toBe(true);
    expect(forEditor.comments[0].hidden).toBe(true);
    expect((await api.post(path(`/${c.id}/restore`), { as: await reader() })).status).toBe(403);
    expect((await api.post(path(`/${c.id}/restore`), { as: await editor() })).json.hidden).toBe(false);
    expect((await api.get(path())).json.total).toBe(1);
  });

  test('aHiddenCommentTakesNoRepliesFromReaders', async () => {
    const c = (await post({ body: 'spam' })).json;
    for (const e of ['r1', 'r2', 'r3']) await api.put(path(`/${c.id}/report`), { as: await as(`${e}@itba.edu.ar`), body: {} });
    expect((await post({ body: 'x', parentId: c.id })).status).toBe(400);
    expect((await post({ body: 'note', parentId: c.id }, editor)).status).toBe(201);
  });

  test('turningCommentsOffKeepsThemReadableAndBlocksNewOnes', async () => {
    const c = (await post({ body: 'a' })).json;
    expect((await api.put(path('/settings'), { as: await reader(), body: { enabled: false } })).status).toBe(403);
    const off = await api.put(path('/settings'), { as: await editor(), body: { enabled: false } });
    expect(off.text).toBe('{"enabled":false}');
    const t = (await api.get(path())).json;
    expect(t.enabled).toBe(false);
    expect(t.total).toBe(1);
    const blocked = await post({ body: 'b' });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe('CommentsDisabled');
    expect((await api.put(path(`/${c.id}/like`), { as: await reader() })).json.error).toBe('CommentsDisabled');
  });

  test('staffModerates', async () => {
    const c = (await post({ body: 'a' })).json;
    const boss = await staff(api.db);
    expect((await api.put(path(`/${c.id}/pin`), { as: boss, body: { pinned: true } })).status).toBe(200);
    expect((await api.delete(path(`/${c.id}`), { as: boss })).status).toBe(204);
  });

  test('draftArticleIs404ExceptForItsEditors', async () => {
    expect((await api.get('/v1/articles/c-draft/comments')).status).toBe(404);
    expect((await api.post('/v1/articles/c-draft/comments', { as: await reader(), body: { body: 'x' } })).status).toBe(404);
    expect((await api.get('/v1/articles/c-draft/comments', { as: await editor() })).status).toBe(200);
    // Not published yet: nobody can comment.
    const r = await api.post('/v1/articles/c-draft/comments', { as: await editor(), body: { body: 'x' } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ArticleNotPublished');
    expect((await api.get('/v1/articles/nope/comments')).status).toBe(404);
  });
});
