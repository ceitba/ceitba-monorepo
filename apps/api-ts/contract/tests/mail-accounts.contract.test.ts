// Ports apps/api/src/test/java/org/ceitba/api/web/mail/MailAccountsIT.java.
//
// The IT stubs GoogleMailOAuthClient.exchangeCode/revoke (@SpyBean); a jar
// would call oauth2.googleapis.com. What never reaches Google is black-box
// here: the staff-only checks, the consent URL, the callback refusals that
// stop before the code exchange (forged state, not staff, access_denied) and
// the 409 without a sender. The exchange-dependent parts
// (wrong_account, missing_scope, the stored token, delete-revokes) are
// in-process: test/mail/accounts.test.ts. The OAuth `state` is minted with
// MailOAuthStateService and the test JWT secret, like the IT's states.issue.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';
import { oauthStates } from '../../test/digest/support/seed';

const api = useServer({ env: {
  MAIL_ENABLED: 'true',
  GOOGLE_MAIL_REDIRECT_URI: 'https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback',
  // 32 zero bytes
  MAIL_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} });

const HOME = 'https://ceitba.org.ar/newsletter/admin/digests';
let staffId: string;

const staff = async () => bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));
const user = async () => bearer(await mintJwt({ email: 'bob@itba.edu.ar', name: 'Bob' }));
const callback = (query: Record<string, string>) => api.get('/v1/mail/accounts/oauth/callback', { query });

async function seedAccount(status = 'connected', enc = 'x'): Promise<number> {
  const [r] = await api.db`INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes, status, connected_at)
                           VALUES ('ceitba@itba.edu.ar', 'ceitba', NULL, ${enc}, 'gmail.send', ${status}, '2026-09-01T12:00:00Z') RETURNING id`;
  return Number(r!.id);
}

describe('MailAccountsIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public.mail_sender_account, public.mail_account_state, public.ceitba_staff, public."user" CASCADE`;
    staffId = await seedStaff(api.db, 'alice@itba.edu.ar');
  });

  test('endpointsAreStaffOnly', async () => {
    expect((await api.post('/v1/mail/accounts/ceitba/connect')).status).toBe(401);
    expect((await api.post('/v1/mail/accounts/ceitba/connect', { as: await user() })).status).toBe(403);
    expect((await api.get('/v1/mail/accounts', { as: await user() })).status).toBe(403);
    expect((await api.delete('/v1/mail/accounts/1', { as: await user() })).status).toBe(403);
  });

  test('connectReturnsTheGoogleConsentUrl', async () => {
    const r = await api.post('/v1/mail/accounts/ceitba/connect', { as: await staff() });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json)).toEqual(['authorizationUrl']);
    const url: string = r.json.authorizationUrl;
    for (const s of ['https://accounts.google.com/o/oauth2/v2/auth?', 'access_type=offline', 'prompt=consent',
      'login_hint=ceitba@itba.edu.ar', 'hd=itba.edu.ar', 'gmail.send%20openid%20email', 'state=']) expect(url).toContain(s);
    expect(url).toMatch(new RegExp('^https://accounts\\.google\\.com/o/oauth2/v2/auth\\?response_type=code&client_id=test-client-id'
      + '&redirect_uri=https://ceitba\\.org\\.ar/api/v1/mail/accounts/oauth/callback'
      + '&scope=https://www\\.googleapis\\.com/auth/gmail\\.send%20openid%20email&state=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+'
      + '&access_type=offline&prompt=consent&login_hint=ceitba@itba\\.edu\\.ar&hd=itba\\.edu\\.ar$'));
    // The state binds the staff user who asked.
    const state = /state=([^&]+)/.exec(url)![1]!;
    expect(oauthStates().verify(state)).toBe(staffId);
  });

  test('callbackRejectsAnotherAccountABadStateAndAMissingScope', async () => {
    const forged = await callback({ code: 'x', state: 'forged.state' });
    expect(forged.status).toBe(302);
    expect(forged.location).toBe(`${HOME}?mail=error&reason=invalid_state`);
    expect(forged.headers.get('cache-control')).toBe('no-store');
    expect(forged.text).toBe('');
    // A valid state of a user who is not (or no longer) staff.
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    expect((await callback({ code: 'x', state: oauthStates().issue(bob) })).location).toBe(`${HOME}?mail=error&reason=not_staff`);
    expect((await callback({ error: 'access_denied', state: oauthStates().issue(staffId) })).location).toBe(`${HOME}?mail=error&reason=access_denied`);
    // Not in the IT: other Google errors, a missing code and no state at all.
    expect((await callback({ error: 'server_error', state: oauthStates().issue(staffId) })).location).toBe(`${HOME}?mail=error&reason=exchange_failed`);
    expect((await callback({ code: ' ', state: oauthStates().issue(staffId) })).location).toBe(`${HOME}?mail=error&reason=exchange_failed`);
    expect((await callback({})).location).toBe(`${HOME}?mail=error&reason=invalid_state`);

    const [{ n }] = await api.db`SELECT COUNT(*)::int AS n FROM public.mail_sender_account` as unknown as [{ n: number }];
    expect(n).toBe(0);
    const q = await api.get('/v1/digests/quota', { as: await staff() });
    expect(q.json.senderStatus).toBe('missing');
  });

  test('testSendWithoutAConnectedSenderIs409AndDeleteRevokesAtGoogle', async () => {
    const c = await api.post('/v1/digests', { as: await staff(), body: { weekStart: '2026-09-28' } });
    expect(c.status).toBe(201);
    const t = await api.post(`/v1/digests/${c.json.id}/test`, { as: await staff() });
    expect(t.status).toBe(409);
    expect(t.json.error).toBe('MAIL_SENDER_NOT_CONNECTED');
    expect(t.json.message).toBe('no connected Gmail sender account for ceitba@itba.edu.ar');
    // Nothing attempted, nothing logged.
    const [{ n }] = await api.db`SELECT COUNT(*)::int AS n FROM public.mail_send_log` as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  // Not in the IT: listing, status and delete with a stored row (no Google call:
  // the stored token does not decrypt, so there is nothing to revoke).
  test('listShowsTheAccountWithoutSecretsAndAnUndecryptableTokenIsBroken', async () => {
    const id = await seedAccount();
    const l = await api.get('/v1/mail/accounts', { as: await staff() });
    expect(l.status).toBe(200);
    expect(l.text).toBe(`[{"id":${id},"email":"ceitba@itba.edu.ar","ownerType":"ceitba","ownerRef":null,"status":"connected","connectedAt":"2026-09-01T12:00:00Z","lastError":null,"lastUsedAt":null}]`);
    expect((await api.get('/v1/digests/quota', { as: await staff() })).json.senderStatus).toBe('connected');

    // Java quirk kept: the test send runs in a read-only transaction
    // (DigestService.sendTest), so marking the undecryptable account broken
    // fails ("cannot execute UPDATE in a read-only transaction") -> 500, and
    // the row stays `connected`. The worker path (read-write) marks it broken:
    // test/mail/accounts.test.ts.
    const c = await api.post('/v1/digests', { as: await staff(), body: { weekStart: '2026-09-28' } });
    const t = await api.post(`/v1/digests/${c.json.id}/test`, { as: await staff() });
    expect(t.status).toBe(500);
    expect(t.json.error).toBe('InternalServerError');
    const [row] = await api.db`SELECT status, last_error FROM public.mail_sender_account`;
    expect(row).toMatchObject({ status: 'connected', last_error: null });
    expect((await api.get('/v1/digests/quota', { as: await staff() })).json.senderStatus).toBe('connected');
    const [{ n }] = await api.db`SELECT COUNT(*)::int AS n FROM public.mail_send_log` as unknown as [{ n: number }];
    expect(n).toBe(0);

    await api.db`UPDATE public.mail_sender_account SET status = 'broken', last_error = 'invalid_grant'`;
    expect((await api.get('/v1/digests/quota', { as: await staff() })).json.senderStatus).toBe('broken');
    const again = await api.post(`/v1/digests/${c.json.id}/test`, { as: await staff() });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('MAIL_SENDER_NOT_CONNECTED');
    expect(again.json.message).toBe('Gmail sender account ceitba@itba.edu.ar is broken (invalid_grant): reconnect it');

    const d = await api.delete(`/v1/mail/accounts/${id}`, { as: await staff() });
    expect(d.status).toBe(204);
    const nf = await api.delete(`/v1/mail/accounts/${id}`, { as: await staff() });
    expect(nf.status).toBe(404);
    expect(nf.json.error).toBe('ResourceNotFound');
    expect(nf.json.message).toBe(`MailSenderAccount with identifier '${id}' not found`);
    expect((await api.get('/v1/mail/accounts', { as: await staff() })).text).toBe('[]');
  });
});
