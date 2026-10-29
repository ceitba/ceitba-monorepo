// Polls close by deps.clock (docs/NEWSLETTER-ENGAGEMENT.md "Polls"): a vote is accepted
// before closesAt, refused with 409 PollClosed after it, and after_close results then show.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintJwt, seedUser } from '../../contract/support';
import { MutableClock } from '../../src/infra/clock';
import { seedArticle, seedMembership, seedOrg, wipeNews } from '../news/support/fixtures';
import { testApp, type TestApp } from '../support/app';

const clock = new MutableClock('2026-11-10T12:00:00Z');
let t: TestApp;

const auth = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });

beforeAll(async () => {
  t = await testApp({ overrides: { clock } });
  await wipeNews(t.sql);
  await seedOrg(t.sql, 'robotica', 'Robótica', 'Club de Robótica');
  await seedArticle(t.sql, { id: 'p-clock', title: 'T', excerpt: 'e', body: [], category: 'tech', authors: ['A'], organization: 'robotica' });
  await seedMembership(t.sql, await seedUser(t.sql, 'editor@itba.edu.ar'), 'robotica', 'member');
});
afterAll(async () => { await t?.close(); });

describe('poll closing follows the clock', () => {
  test('votesUntilClosesAt_thenPollClosedAndResultsShow', async () => {
    const created = await t.request('POST', '/v1/articles/p-clock/polls', {
      headers: await auth('editor@itba.edu.ar'),
      body: { question: '¿Cuándo?', options: ['Mañana', 'Tarde'], resultsVisibility: 'after_close', closesAt: '2026-11-11T12:00:00Z' },
    });
    expect(created.status).toBe(201);
    const poll = created.json;
    const before = await t.request('PUT', `/v1/articles/p-clock/polls/${poll.id}/vote`, { headers: await auth('reader@itba.edu.ar'), body: { optionId: poll.options[0].id } });
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({ closed: false, resultsVisible: false, totalVotes: null });

    clock.set('2026-11-11T12:00:01Z');
    const after = await t.request('PUT', `/v1/articles/p-clock/polls/${poll.id}/vote`, { headers: await auth('reader@itba.edu.ar'), body: { optionId: poll.options[1].id } });
    expect(after.status).toBe(409);
    expect(after.json.error).toBe('PollClosed');
    const read = await t.request('GET', `/v1/articles/p-clock/polls/${poll.id}`);
    expect(read.json).toMatchObject({ closed: true, resultsVisible: true, totalVotes: 1 });
  });
});
