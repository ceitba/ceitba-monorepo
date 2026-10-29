// The Spring app read these lists with no ORDER BY, so clients got them in heap order. Bun asks for that order
// explicitly (ORDER BY ctid): the planner may otherwise pick an index-only scan that sorts by slug, as
// scripts/dropin.ts saw on a vacuumed production-shaped database. contract/tests/heap-order.contract.test.ts
// checks the resulting order on both runtimes; this pins the query, since that plan can't be forced from outside.
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { followsOf } from '../../src/http/auth/repo';
import { allVotes } from '../../src/features/analytics/repo';
import { followsOf as userFollowsOf } from '../../src/features/user/repo';
import { followsOfUser } from '../../src/features/news/repo';
import type { Db } from '../../src/db/client';

async function sqlOf(run: (db: Db) => Promise<unknown>): Promise<string> {
  const seen: string[] = [];
  const db = drizzle.mock({ logger: { logQuery: (q: string) => { seen.push(q); } } }) as unknown as Db;
  await run(db).catch(() => {});
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

const USER = '00000000-0000-0000-0000-000000000000';

describe('lists that were unordered in Java keep heap order', () => {
  test('authMeFollows', async () => {
    expect(await sqlOf((db) => followsOf(db, USER))).toMatch(/order by ctid$/i);
  });

  test('userFeatureFollows', async () => {
    expect(await sqlOf((db) => userFollowsOf(db, USER))).toMatch(/order by ctid$/i);
  });

  test('newsFeatureFollows', async () => {
    expect(await sqlOf((db) => followsOfUser(db, USER))).toMatch(/order by ctid$/i);
  });

  test('analyticsVoteBreakdown', async () => {
    expect(await sqlOf((db) => allVotes(db))).toMatch(/ORDER BY v\.ctid$/);
  });
});
