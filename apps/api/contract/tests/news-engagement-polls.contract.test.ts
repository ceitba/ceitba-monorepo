// Article polls (docs/NEWSLETTER-ENGAGEMENT.md "Polls"): editing, voting, closing and
// results visibility enforced server-side.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer } from '../support';
import { as, seedArticle, seedMembership, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

const reader = () => as('reader@itba.edu.ar', 'Reader');
const editor = () => as('editor@itba.edu.ar', 'Editor');
const base = '/v1/articles/p-art/polls';

async function create(body: Record<string, unknown> = {}) {
  return api.post(base, { as: await editor(), body: { question: '¿Qué horario?', options: ['Mañana', 'Tarde', 'Noche'], ...body } });
}

describe('ArticlePolls', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'robotica', 'Robótica', 'Club de Robótica');
    await seedArticle(api.db, { id: 'p-art', title: 'T', excerpt: 'e', body: [], category: 'tech', authors: ['A'], organization: 'robotica' });
    const editorId = await seedUser(api.db, 'editor@itba.edu.ar', { name: 'Editor' });
    await seedMembership(api.db, editorId, 'robotica', 'member');
  });

  test('editorCreates_shapeAndDefaults', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    const p = r.json;
    expect(Object.keys(p)).toEqual(['id', 'question', 'options', 'resultsVisibility', 'closesAt', 'closed', 'totalVotes', 'myVote', 'resultsVisible', 'canEdit']);
    expect(p).toMatchObject({ question: '¿Qué horario?', resultsVisibility: 'after_vote', closesAt: null, closed: false, totalVotes: 0, myVote: null, resultsVisible: true, canEdit: true });
    expect(p.options.map((o: { label: string }) => o.label)).toEqual(['Mañana', 'Tarde', 'Noche']);
    expect(p.options[0].votes).toBe(0);
  });

  test('readersCannotCreateAndOptionsAreBounded', async () => {
    expect((await api.post(base, { as: await reader(), body: { question: 'q', options: ['a', 'b'] } })).status).toBe(403);
    expect((await api.post(base, { body: { question: 'q', options: ['a', 'b'] } })).status).toBe(401);
    expect((await create({ options: ['solo'] })).status).toBe(400);
    expect((await create({ options: ['1', '2', '3', '4', '5', '6', '7'] })).status).toBe(400);
    expect((await create({ options: ['a', ' '] })).status).toBe(400);
  });

  test('afterVote_countsHiddenUntilTheReaderVotes', async () => {
    const p = (await create()).json;
    const anon = (await api.get(`${base}/${p.id}`)).json;
    expect(anon).toMatchObject({ totalVotes: null, resultsVisible: false, canEdit: false, myVote: null });
    expect(anon.options.every((o: { votes: number | null }) => o.votes === null)).toBe(true);

    const tarde = p.options[1].id;
    const voted = await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: tarde } });
    expect(voted.status).toBe(200);
    expect(voted.json).toMatchObject({ myVote: tarde, resultsVisible: true, totalVotes: 1 });
    expect(voted.json.options[1].votes).toBe(1);

    // Changing the vote moves it; removing it hides the counts again.
    const changed = (await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: p.options[0].id } })).json;
    expect(changed.options.map((o: { votes: number }) => o.votes)).toEqual([1, 0, 0]);
    const removed = (await api.delete(`${base}/${p.id}/vote`, { as: await reader() })).json;
    expect(removed).toMatchObject({ myVote: null, resultsVisible: false, totalVotes: null });
  });

  test('afterClose_hidesCountsEvenFromVotersUntilClosed', async () => {
    const p = (await create({ resultsVisibility: 'after_close' })).json;
    const voted = (await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: p.options[0].id } })).json;
    expect(voted).toMatchObject({ resultsVisible: false, totalVotes: null, myVote: p.options[0].id });
    // The editor always sees them.
    expect((await api.get(`${base}/${p.id}`, { as: await editor() })).json.totalVotes).toBe(1);
    const closed = (await api.patch(`${base}/${p.id}`, { as: await editor(), body: { close: true } })).json;
    expect(closed.closed).toBe(true);
    expect((await api.get(`${base}/${p.id}`)).json).toMatchObject({ closed: true, resultsVisible: true, totalVotes: 1 });
  });

  test('closedPollRefusesVotes_reopenAcceptsThem', async () => {
    const p = (await create({ closesAt: '2020-01-01T00:00:00Z' })).json;
    expect(p.closed).toBe(true);
    expect(p.closesAt).toBe('2020-01-01T00:00:00Z');
    const r = await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: p.options[0].id } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('PollClosed');
    expect((await api.patch(`${base}/${p.id}`, { as: await editor(), body: { reopen: true } })).json.closed).toBe(false);
    expect((await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: p.options[0].id } })).status).toBe(200);
  });

  test('optionsLockOnceThereAreVotes', async () => {
    const p = (await create()).json;
    const edited = (await api.patch(`${base}/${p.id}`, { as: await editor(), body: { options: ['Sí', 'No'], question: 'Nueva' } })).json;
    expect(edited.question).toBe('Nueva');
    expect(edited.options.map((o: { label: string }) => o.label)).toEqual(['Sí', 'No']);
    await api.put(`${base}/${p.id}/vote`, { as: await reader(), body: { optionId: edited.options[0].id } });
    const r = await api.patch(`${base}/${p.id}`, { as: await editor(), body: { options: ['A', 'B'] } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('PollHasVotes');
    // The question can still change.
    expect((await api.patch(`${base}/${p.id}`, { as: await editor(), body: { question: 'Otra' } })).json.question).toBe('Otra');
  });

  test('voteForAnOptionOfAnotherPollIs400', async () => {
    const a = (await create()).json;
    const b = (await create()).json;
    expect((await api.put(`${base}/${a.id}/vote`, { as: await reader(), body: { optionId: b.options[0].id } })).status).toBe(400);
    expect((await api.put(`${base}/${a.id}/vote`, { body: { optionId: a.options[0].id } })).status).toBe(401);
  });

  test('listAndDelete', async () => {
    const a = (await create({ question: 'Primera' })).json;
    await create({ question: 'Segunda' });
    expect((await api.get(base)).json.map((p: { question: string }) => p.question)).toEqual(['Primera', 'Segunda']);
    expect((await api.delete(`${base}/${a.id}`, { as: await reader() })).status).toBe(403);
    expect((await api.delete(`${base}/${a.id}`, { as: await staff(api.db) })).status).toBe(204);
    expect((await api.get(`${base}/${a.id}`)).status).toBe(404);
    // A poll id under another article is not found.
    await seedArticle(api.db, { id: 'other', title: 'O', excerpt: 'e', body: [], category: 'tech', authors: ['A'] });
    const second = (await api.get(base)).json[0].id;
    expect((await api.get(`/v1/articles/other/polls/${second}`)).status).toBe(404);
  });

  test('independentAuthorEditsPollsOnlyWhileUnpublished', async () => {
    const authorId = await seedUser(api.db, 'indie@itba.edu.ar', { name: 'Indie' });
    await seedArticle(api.db, { id: 'indie', title: 'I', excerpt: 'e', body: [], category: 'tech', authors: ['I'], status: 'draft', createdBy: authorId });
    const indie = await as('indie@itba.edu.ar', 'Indie');
    expect((await api.post('/v1/articles/indie/polls', { as: indie, body: { question: 'q', options: ['a', 'b'] } })).status).toBe(201);
    await api.db`UPDATE public.articles SET status = 'published' WHERE id = 'indie'`;
    expect((await api.post('/v1/articles/indie/polls', { as: indie, body: { question: 'q', options: ['a', 'b'] } })).status).toBe(403);
  });
});
