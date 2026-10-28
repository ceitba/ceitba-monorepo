// Ports apps/api/src/test/java/org/ceitba/api/web/user/AccountDeletionIT.java
// (@TestPropertySource auth.cookie.domain=ceitba.org.ar -> AUTH_COOKIE_DOMAIN).
// DELETE /v1/me: personal rows go, shared wiki material stays (with the user
// row anonymized), other users are untouched, refresh tokens stop working.
// concurrentDeletionsCannotRemoveTheLastStaffMember holds a deletion's
// transaction open: in-process in test/user/account-deletion-concurrency.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, seedApiKey, seedRefreshToken, seedUser, useServer } from '../support';

const api = useServer({ env: { AUTH_COOKIE_DOMAIN: 'ceitba.org.ar' } });

let alice: string;
let bob: string;
const as = async (email: string, name: string) => bearer(await mintJwt({ email, name }));
const asAlice = () => as('alice@itba.edu.ar', 'Alice');

async function seedPersonalData(u: string) {
  const db = api.db;
  await db`INSERT INTO public.api_keys (user_id, name, key_hash, expires_at) VALUES (${u}, 'k', ${crypto.randomUUID().replaceAll('-', '') + '0'.repeat(32)}, now() + interval '1 day')`;
  await db`INSERT INTO public.user_follows (user_id, org_slug) VALUES (${u}, 'ceitba')`;
  await db`INSERT INTO public.user_organizations (user_id, org_slug) VALUES (${u}, 'ceitba')`;
  await db`INSERT INTO public.saved_schedules (user_id, name, payload) VALUES (${u}, 's', '{}'::jsonb)`;
  await db`INSERT INTO public.share_sessions (token, creator_user_id) VALUES (${u.slice(0, 16)}, ${u})`;
  await db`INSERT INTO public.study_groups (owner_id, title, subject_id, type, locations, due_at)
           VALUES (${u}, 'g', '93.41', 'GUIAS', ARRAY['SDR'], now() + interval '1 day')`;
  await db`INSERT INTO public.study_group_participants (group_id, user_id) SELECT id, ${u} FROM public.study_groups WHERE owner_id = ${u}`;
  await db`INSERT INTO wiki.subject_difficulty (subject_id, user_id, value, updated_at) VALUES ('93.41', ${u}, 3, now())`;
  await db`INSERT INTO wiki.subject_bookmarks (subject_id, user_id) VALUES ('93.41', ${u})`;
  await db`INSERT INTO wiki."Subject_Bookmarks" (subject_id, user_id) VALUES ('93.41', ${u})`;
  await db`INSERT INTO public.ceitba_staff (user_id, branch, start, "end") VALUES (${u}, 'IT', now() - interval '1 day', now() + interval '1 day')`;
  await seedRefreshToken(db, u, { deviceName: 'device' });
  await db`INSERT INTO public.user_devices (token, user_id, platform) VALUES (${`tok-${u}`}, ${u}, 'ios')`;
}

const count = async (table: string, column: string, u: string): Promise<number> =>
  Number((await api.db.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [u]))[0]!.n);
const userExists = async (id: string) => (await api.db`SELECT 1 FROM public."user" WHERE id = ${id}`).length > 0;

async function assertPersonalDataGone(u: string) {
  for (const [t, c] of [
    ['public.api_keys', 'user_id'], ['public.refresh_tokens', 'user_id'], ['public.user_devices', 'user_id'],
    ['public.user_follows', 'user_id'], ['public.user_organizations', 'user_id'], ['public.saved_schedules', 'user_id'],
    ['public.share_sessions', 'creator_user_id'], ['public.ceitba_staff', 'user_id'], ['public.study_groups', 'owner_id'],
    ['public.study_group_participants', 'user_id'], ['wiki.subject_difficulty', 'user_id'], ['wiki.subject_bookmarks', 'user_id'],
    ['wiki."Subject_Bookmarks"', 'user_id'],
  ] as const) expect({ t, n: await count(t, c, u) }).toEqual({ t, n: 0 });
}

async function assertPersonalDataIntact(u: string) {
  for (const [t, c] of [
    ['public.api_keys', 'user_id'], ['public.refresh_tokens', 'user_id'], ['public.user_devices', 'user_id'],
    ['public.user_follows', 'user_id'], ['public.saved_schedules', 'user_id'], ['public.ceitba_staff', 'user_id'],
    ['public.study_groups', 'owner_id'], ['public.study_group_participants', 'user_id'], ['wiki.subject_bookmarks', 'user_id'],
  ] as const) expect({ t, n: await count(t, c, u) }).toEqual({ t, n: 1 });
}

describe('AccountDeletionIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user", public.subject, public.careers, public.organizations, public.deleted_firebase_accounts CASCADE`;
    alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await api.db`INSERT INTO public.organizations (slug, name, full_name) VALUES ('ceitba', 'CEITBA', 'Centro de Estudiantes')`;
    await api.db`INSERT INTO public.subject (id, name, updated_at) VALUES ('93.41', 'Algebra', now())`;
    await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('INF', 'Informatica', now())`;
    for (const u of [alice, bob]) await seedPersonalData(u);
  });

  test('deleteRequiresAuthentication', async () => {
    expect((await api.delete('/v1/me')).status).toBe(401);
  });

  test('apiKeyCannotDeleteTheAccount', async () => {
    const { key } = await seedApiKey(api.db, alice, null, 1);
    const r = await api.delete('/v1/me', { as: apiKey(key) });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('AccessDenied');
    expect(await userExists(alice)).toBe(true);
    expect(await count('public.api_keys', 'user_id', alice)).toBe(2);
    expect(await count('public.ceitba_staff', 'user_id', alice)).toBe(1);
  });

  test('lastActiveStaffMemberCannotDeleteTheAccount', async () => {
    await api.db`DELETE FROM public.ceitba_staff WHERE user_id = ${bob}`;
    const r = await api.delete('/v1/me', { as: await asAlice() });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('LastActiveStaff');
    expect(r.json.message).toBe('You are the only active staff member. Grant the STAFF role to someone else before deleting your account.');
    expect(await userExists(alice)).toBe(true);
    await assertPersonalDataIntact(alice);
  });

  test('staffMemberCanDeleteWhenAnotherStaffMemberRemains', async () => {
    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);
    expect(await count('public.ceitba_staff', 'user_id', bob)).toBe(1);
  });

  test('userWithoutSharedContributionsIsHardDeleted', async () => {
    const [{ id: aliceSession }] = await api.db`SELECT id FROM public.share_sessions WHERE creator_user_id = ${alice}` as unknown as [{ id: string }];
    await api.db`INSERT INTO public.share_session_participants (session_id, user_id, display_name) VALUES (${aliceSession}, ${bob}, 'Bob')`;
    await api.db`INSERT INTO public.articles (id, title, excerpt, category, created_by) VALUES ('a1', 't', 'e', 'c', ${alice})`;

    const r = await api.delete('/v1/me', { as: await asAlice() });
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    expect(r.setCookies.length).toBeGreaterThan(0);

    expect(await userExists(alice)).toBe(false);
    expect((await api.db`SELECT 1 FROM public."user" WHERE email = 'alice@itba.edu.ar'`).length).toBe(0);
    await assertPersonalDataGone(alice);
    expect(Number((await api.db`SELECT count(*)::int AS n FROM public.deleted_firebase_accounts`)[0]!.n)).toBe(0);
    expect(await count('public.share_session_participants', 'session_id', aliceSession)).toBe(0);
    expect((await api.db`SELECT created_by FROM public.articles WHERE id = 'a1'`)[0]!.created_by).toBeNull();

    expect(await userExists(bob)).toBe(true);
    await assertPersonalDataIntact(bob);
  });

  test('deletionExpiresBothDomainScopedAndHostOnlySessionCookies', async () => {
    const r = await api.delete('/v1/me', { as: await asAlice() });
    expect(r.status).toBe(204);
    expect(r.setCookies).toHaveLength(2);
    for (const c of r.setCookies) {
      expect(c.startsWith('ceitba_session=;')).toBe(true);
      expect(c).toContain('Max-Age=0');
    }
    expect(r.setCookies.some((c) => c.includes('Domain=ceitba.org.ar'))).toBe(true);
    expect(r.setCookies.some((c) => !c.includes('Domain='))).toBe(true);
  });

  test('userWithSharedContributionsIsAnonymized', async () => {
    await api.db`UPDATE public."user" SET firebase_uid = 'legacy-uid-alice' WHERE id = ${alice}`;
    const note = crypto.randomUUID();
    await api.db`INSERT INTO wiki.subject_note (id, subject_id, owner_name, link, uploader_id, updated_at)
                 VALUES (${note}, '93.41', 'Prof', 'https://example.com/n', ${alice}, now())`;
    await api.db`INSERT INTO wiki.subject_note_vote (note_id, user_id, type) VALUES (${note}, ${bob}, 'LIKE')`;
    const comment = crypto.randomUUID();
    await api.db`INSERT INTO wiki.subject_comment (id, subject_id, user_id, content, updated_at) VALUES (${comment}, '93.41', ${alice}, 'my comment', now())`;
    await api.db`INSERT INTO wiki.subject_comment_vote (comment_id, user_id, type) VALUES (${comment}, ${bob}, 'LIKE')`;
    await api.db`INSERT INTO wiki.subject_wiki_edit_proposal (id, subject_id, proposed_by, proposed_content, status)
                 VALUES (${crypto.randomUUID()}, '93.41', ${alice}, 'pending text', 'PENDING')`;

    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);

    const [t] = await api.db`SELECT * FROM public."user" WHERE id = ${alice}`;
    expect(t!.email).toBe(`deleted-${alice}@deleted.invalid`);
    expect(t!.name).toBeNull();
    expect(t!.google_sub).toBeNull();
    expect(t!.avatar_url).toBeNull();
    expect(t!.firebase_uid).toBeNull();
    await assertPersonalDataGone(alice);
    const deleted = async (uid: string) => (await api.db`SELECT EXISTS (SELECT 1 FROM public.deleted_firebase_accounts
      WHERE firebase_uid_sha256 = encode(sha256(convert_to(${uid}, 'UTF8')), 'hex')) AS e`)[0]!.e;
    expect(await deleted('legacy-uid-alice')).toBe(true);
    expect(await deleted('legacy-uid-bob')).toBe(false);
    const hashes = (await api.db`SELECT firebase_uid_sha256 FROM public.deleted_firebase_accounts`).map((r) => r.firebase_uid_sha256 as string);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toHaveLength(64);
    expect(hashes[0]).not.toContain('legacy-uid-alice');

    expect(await count('wiki.subject_note', 'id', note)).toBe(1);
    expect(await count('wiki.subject_note_vote', 'user_id', bob)).toBe(1);
    expect(await count('wiki.subject_comment', 'id', comment)).toBe(0);
    expect(await count('wiki.subject_comment_vote', 'user_id', bob)).toBe(0);
    expect(await count('wiki.subject_wiki_edit_proposal', 'proposed_by', alice)).toBe(0);
    await assertPersonalDataIntact(bob);
  });

  test('deletionHandsOwnedStudyGroupsToTheEarliestJoiner', async () => {
    const carol = await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
    const [{ id: shared }] = await api.db`SELECT id FROM public.study_groups WHERE owner_id = ${alice}` as unknown as [{ id: string }];
    await api.db`INSERT INTO public.study_group_participants (group_id, user_id, joined_at) VALUES (${shared}, ${bob}, now() + interval '2 hours')`;
    await api.db`INSERT INTO public.study_group_participants (group_id, user_id, joined_at) VALUES (${shared}, ${carol}, now() + interval '1 hour')`;
    const [{ id: solo }] = await api.db`INSERT INTO public.study_groups (owner_id, title, subject_id, type, locations, due_at)
      VALUES (${alice}, 'solo', '93.41', 'AHORA', ARRAY['SDF'], now() + interval '1 day') RETURNING id` as unknown as [{ id: string }];
    await api.db`INSERT INTO public.study_group_participants (group_id, user_id) VALUES (${solo}, ${alice})`;

    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);

    await assertPersonalDataGone(alice);
    expect((await api.db`SELECT owner_id FROM public.study_groups WHERE id = ${shared}`)[0]!.owner_id).toBe(carol);
    expect((await api.db`SELECT user_id FROM public.study_group_participants WHERE group_id = ${shared}`).map((r) => r.user_id).sort())
      .toEqual([bob, carol].sort());
    expect(await count('public.study_groups', 'id', solo)).toBe(0);
    expect(await count('public.study_groups', 'owner_id', bob)).toBe(1);
  });

  test('deletionCleansDevicesStudyGroupsAndProposalsTogether', async () => {
    const db = api.db;
    const [{ id: bobGroup }] = await db`SELECT id FROM public.study_groups WHERE owner_id = ${bob}` as unknown as [{ id: string }];
    await db`INSERT INTO public.study_group_participants (group_id, user_id) VALUES (${bobGroup}, ${alice})`;
    const proposal = async (author: string, status: string) => {
      const id = crypto.randomUUID();
      await db`INSERT INTO public.proposal (id, author_id, title, description, topic, status) VALUES (${id}, ${author}, 't', 'd', 'CEITBA', ${status})`;
      return id;
    };
    const alias = (p: string, u: string, a: string) => db`INSERT INTO public.proposal_alias (proposal_id, user_id, alias) VALUES (${p}, ${u}, ${a})`;
    const vote = async (p: string, u: string, value: 'UP' | 'DOWN') => {
      await db`INSERT INTO public.proposal_vote (proposal_id, user_id, value) VALUES (${p}, ${u}, ${value})`;
      if (value === 'UP') await db`UPDATE public.proposal SET up_count = up_count + 1 WHERE id = ${p}`;
      else await db`UPDATE public.proposal SET down_count = down_count + 1 WHERE id = ${p}`;
    };
    const comment = async (p: string, author: string, parent: string | null, body: string) => {
      const id = crypto.randomUUID();
      await db`INSERT INTO public.proposal_comment (id, proposal_id, author_id, parent_id, body) VALUES (${id}, ${p}, ${author}, ${parent}, ${body})`;
      await db`UPDATE public.proposal SET comment_count = comment_count + 1 WHERE id = ${p}`;
      return id;
    };
    const approved = await proposal(alice, 'APPROVED');
    const pending = await proposal(alice, 'PENDING');
    const bobs = await proposal(bob, 'APPROVED');
    await alias(approved, alice, 'AlfaRojo');
    await alias(approved, bob, 'BetaAzul');
    await alias(pending, alice, 'GammaVerde');
    await alias(bobs, bob, 'DeltaGris');
    await alias(bobs, alice, 'EtaNegro');
    await vote(approved, bob, 'UP');
    await vote(bobs, alice, 'DOWN');
    const bobComment = await comment(approved, bob, null, 'buena idea');
    const aliceReply = await comment(approved, alice, bobComment, 'gracias');
    const aliceComment = await comment(bobs, alice, null, 'no me convence');

    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);

    expect(await userExists(alice)).toBe(false);
    await assertPersonalDataGone(alice);
    expect(await count('public.study_groups', 'id', bobGroup)).toBe(1);
    expect(await count('public.study_group_participants', 'group_id', bobGroup)).toBe(1);

    expect(await count('public.proposal', 'id', pending)).toBe(0);
    const [a] = await db`SELECT author_id, up_count, comment_count FROM public.proposal WHERE id = ${approved}`;
    expect(a).toEqual({ author_id: null, up_count: 1, comment_count: 1 });
    const [b] = await db`SELECT down_count, comment_count FROM public.proposal WHERE id = ${bobs}`;
    expect(b).toEqual({ down_count: 0, comment_count: 0 });
    for (const c of [aliceReply, aliceComment]) {
      const [row] = await db`SELECT author_id, body, deleted_at FROM public.proposal_comment WHERE id = ${c}`;
      expect(row!.author_id).toBeNull();
      expect(row!.body).toBeNull();
      expect(row!.deleted_at).not.toBeNull();
    }
    expect((await db`SELECT body FROM public.proposal_comment WHERE id = ${bobComment}`)[0]!.body).toBe('buena idea');
    expect(await count('public.proposal_alias', 'user_id', alice)).toBe(0);
    expect(await count('public.proposal_alias', 'user_id', bob)).toBe(2);
    expect(await count('public.proposal_vote', 'user_id', alice)).toBe(0);
    expect(await count('public.proposal_vote', 'user_id', bob)).toBe(1);
    await assertPersonalDataIntact(bob);
  });

  test('refreshTokensStopWorkingAfterDeletion', async () => {
    const token = await seedRefreshToken(api.db, alice, { deviceName: 'phone' });
    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);
    const r = await api.post('/v1/auth/refresh', { body: { refreshToken: token } });
    expect(r.status).toBe(401);
  });

  test('signingInAgainCreatesAFreshAccount', async () => {
    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);
    const r = await api.get('/v1/auth/me', { as: await asAlice() });
    expect(r.status).toBe(200);
    expect(r.json.email).toBe('alice@itba.edu.ar');
    expect(r.json.role).toBe('user');
    const [fresh] = await api.db`SELECT id FROM public."user" WHERE email = 'alice@itba.edu.ar'`;
    expect(fresh!.id).not.toBe(alice);
  });

  test('deletionTombstonesCommentsWithRepliesAndDropsTheRest', async () => {
    const db = api.db;
    await db`INSERT INTO public.articles (id, title, excerpt, body, category, authors, status) VALUES ('art', 'T', 'e', '[]', 'tech', '[]', 'published')`;
    const [top, lone, reply, selfTop, selfReply] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await db`INSERT INTO public.article_comments (id, article_id, user_id, parent_id, body, created_at) VALUES
             (${top}, 'art', ${alice}, NULL, 'top', now()), (${lone}, 'art', ${alice}, NULL, 'lone', now()),
             (${reply}, 'art', ${bob}, ${top}, 'reply', now()),
             (${selfTop}, 'art', ${alice}, NULL, 'self top', now()), (${selfReply}, 'art', ${alice}, ${selfTop}, 'self reply', now())`;
    await db`INSERT INTO public.article_comment_likes (comment_id, user_id, created_at) VALUES (${reply}, ${alice}, now()), (${top}, ${bob}, now())`;
    await db`INSERT INTO public.article_comment_reports (comment_id, user_id, created_at) VALUES (${reply}, ${alice}, now())`;
    const poll = crypto.randomUUID();
    const option = crypto.randomUUID();
    await db`INSERT INTO public.article_polls (id, article_id, question, created_at) VALUES (${poll}, 'art', 'q', now())`;
    await db`INSERT INTO public.article_poll_options (id, poll_id, position, label) VALUES (${option}, ${poll}, 0, 'a')`;
    await db`INSERT INTO public.article_poll_votes (poll_id, user_id, option_id, created_at) VALUES (${poll}, ${alice}, ${option}, now()), (${poll}, ${bob}, ${option}, now())`;

    expect((await api.delete('/v1/me', { as: await asAlice() })).status).toBe(204);

    const comments = await db`SELECT id, user_id, body, deleted_at IS NOT NULL AS deleted FROM public.article_comments ORDER BY body`;
    expect(comments.map((c) => ({ ...c }))).toEqual([
      { id: top, user_id: null, body: '', deleted: true },
      { id: reply, user_id: bob, body: 'reply', deleted: false },
    ]);
    expect(await count('public.article_comment_likes', 'user_id', alice)).toBe(0);
    expect(await count('public.article_comment_likes', 'user_id', bob)).toBe(1);
    expect(await count('public.article_comment_reports', 'user_id', alice)).toBe(0);
    expect(await count('public.article_poll_votes', 'user_id', alice)).toBe(0);
    expect(await count('public.article_poll_votes', 'user_id', bob)).toBe(1);
  });
});
