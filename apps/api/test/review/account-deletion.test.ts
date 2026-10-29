// Account deletion removes a user's subject reviews, "Me sirvió" votes and
// reports (docs/SUBJECT-REVIEWS.md "Schema"), recounting the reports of the
// reviews they reported: also when the account is anonymized and the user row stays.
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { deleteUserData } from '../../src/features/review/repo';
import { AccountDeletionService } from '../../src/features/user/accountDeletion';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

const user = async (email: string) => {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${id}, ${email}, ${email}, now(), now())`;
  return id;
};
const review = async (userId: string, reportCount = 0) => {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public.subject_review (id, subject_id, user_id, year, period, commission, recommend, difficulty, report_count)
              VALUES (${id}, '93.59', ${userId}, 2025, 2, 'A', true, 2, ${reportCount})`;
  return id;
};

let gone: string, other: string, othersReview: string;
beforeEach(async () => {
  await t.sql`TRUNCATE public."user", public.subject CASCADE`;
  await t.sql`INSERT INTO public.subject (id, name, updated_at) VALUES ('93.59', 'Análisis Matemático II', now())`;
  gone = await user('gone@itba.edu.ar');
  other = await user('other@itba.edu.ar');
  await review(gone);
  othersReview = await review(other, 2);
  await t.sql`INSERT INTO public.subject_review_report (review_id, user_id, reason) VALUES (${othersReview}, ${gone}, 'SPAM')`;
  await t.sql`INSERT INTO public.subject_review_helpful (review_id, user_id) VALUES (${othersReview}, ${gone})`;
});

const left = async () => ({
  reviews: Number((await t.sql`SELECT count(*)::int AS n FROM public.subject_review WHERE user_id = ${gone}`)[0]!.n),
  votes: Number((await t.sql`SELECT count(*)::int AS n FROM public.subject_review_helpful WHERE user_id = ${gone}`)[0]!.n),
  reports: Number((await t.sql`SELECT count(*)::int AS n FROM public.subject_review_report WHERE user_id = ${gone}`)[0]!.n),
  othersCount: (await t.sql`SELECT report_count FROM public.subject_review WHERE id = ${othersReview}`)[0]!.report_count,
});

test('deleteUserData_evenWhenTheUserRowStays', async () => {
  await deleteUserData(t.deps.db, gone);
  expect(await left()).toEqual({ reviews: 0, votes: 0, reports: 0, othersCount: 1 });
  expect((await t.sql`SELECT 1 FROM public."user" WHERE id = ${gone}`).length).toBe(1);
});

test('accountDeletionRunsIt', async () => {
  expect(await new AccountDeletionService(t.deps).deleteAccount(gone)).toBe('DELETED');
  expect(await left()).toEqual({ reviews: 0, votes: 0, reports: 0, othersCount: 1 });
});
