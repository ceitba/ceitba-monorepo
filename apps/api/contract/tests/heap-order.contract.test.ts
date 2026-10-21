// Lists the Spring app read with no ORDER BY come back in heap order (the order Postgres stored the rows), and
// clients see that order. scripts/dropin.ts found Bun returning them in another order on a production-shaped
// database: /v1/auth/me sorted `follows` by slug (an index-only scan on the primary key after VACUUM), and the
// analytics summary walked `articles` instead of `article_votes`. Runs on both targets.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer } from '../support';
import { as, seedArticle, seedFollow, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

describe('Heap order of unordered lists', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
  });

  test('meListsFollowsInStorageOrderEvenAfterVacuum', async () => {
    for (const slug of ['zeta', 'alfa', 'medio']) await seedOrg(api.db, slug, slug.toUpperCase(), `Org ${slug}`);
    const userId = await seedUser(api.db, 'f@itba.edu.ar', { name: 'F' });
    for (const slug of ['zeta', 'alfa', 'medio']) await seedFollow(api.db, userId, slug);
    // Volume, so the planner reads one user's follows from an index (as in production) instead of a seq scan. The
    // index-only plan that sorted by slug (seen by scripts/dropin.ts) can't be forced from outside the server, so
    // test/http/heap-order-sql.test.ts also pins the ORDER BY ctid in the query.
    await api.db.unsafe(`INSERT INTO public.organizations (slug, name, full_name)
      SELECT 'org-' || g, 'O' || g, 'Org ' || g FROM generate_series(1, 200) g`);
    await api.db.unsafe(`INSERT INTO public."user" (id, email, name, created_at, updated_at)
      SELECT gen_random_uuid(), 'u' || g || '@itba.edu.ar', 'U' || g, now(), now() FROM generate_series(1, 2000) g`);
    await api.db.unsafe(`INSERT INTO public.user_follows (user_id, org_slug, created_at)
      SELECT u.id, 'org-' || (1 + (abs(hashtext(u.email || k)) % 200)), now()
      FROM public."user" u CROSS JOIN generate_series(1, 5) k WHERE u.email LIKE 'u%@itba.edu.ar'
      ON CONFLICT DO NOTHING`);
    await api.db.unsafe('VACUUM ANALYZE public.user_follows');
    const r = await api.get('/v1/auth/me', { as: await as('f@itba.edu.ar', 'F') });
    expect(r.status).toBe(200);
    expect(r.json.follows).toEqual(['zeta', 'alfa', 'medio']);
  });

  test('voteBreakdownFollowsTheVotesTableOrder', async () => {
    const boss = await staff(api.db);
    for (const id of ['a1', 'a2', 'a3']) {
      await seedArticle(api.db, { id, title: `T ${id}`, excerpt: 'x', body: ['p'], category: 'news', authors: ['x'] });
    }
    for (const id of ['a1', 'a2', 'a3']) {
      await api.db`INSERT INTO public.article_votes (article_id, up_count, down_count) VALUES (${id}, 1, 0)`;
    }
    // Volume, so the join is planned as on production data (hash join driven by articles).
    await api.db.unsafe(`INSERT INTO public.articles (id, title, excerpt, body, category, authors, featured, color_scheme, status,
        created_at, updated_at)
      SELECT 'bulk-' || g, 'B' || g, 'x', '["p"]'::jsonb, 'news', '["x"]'::jsonb, false, 'blue', 'published', now(), now()
      FROM generate_series(1, 3000) g`);
    await api.db.unsafe(`INSERT INTO public.article_votes (article_id, up_count, down_count)
      SELECT 'bulk-' || g, 0, 0 FROM generate_series(1, 3000) g`);
    await api.db.unsafe('VACUUM ANALYZE public.articles, public.article_votes');
    // An update writes a new row version after the others, so a sequential scan now returns a1 last.
    await api.db`UPDATE public.article_votes SET up_count = 2 WHERE article_id = 'a1'`;
    const r = await api.get('/v1/analytics/summary?days=1', { as: boss });
    expect(r.status).toBe(200);
    expect(r.json.voteBreakdown.map((v: { articleId: string }) => v.articleId)).toEqual(['a2', 'a3', 'a1']);
  });
});
