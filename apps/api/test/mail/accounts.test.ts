// In-process ports of:
//   apps/api/src/test/java/org/ceitba/api/web/mail/MailAccountsIT.java (the code exchange is stubbed, like the IT's @SpyBean)
//   apps/api/src/test/java/org/ceitba/api/web/orgmail/OrgMailConnectIT.java (same)
//   apps/api/src/test/java/org/ceitba/api/service/mail/MailSenderAccountServiceTest.java (real rows instead of a mocked repository)
// The black-box halves are contract/tests/mail-accounts.contract.test.ts and orgmail-connect.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff, seedUser } from '../../contract/support';
import { SCOPE_SEND } from '../../src/features/mail/googleMailOAuth';
import { MailTokenCipher } from '../../src/features/mail/logic/mailTokenCipher';
import type { GoogleTokens } from '../../src/features/mail/logic/types';
import { ERR_UNDECRYPTABLE, hasSendScope, isSenderAccount, mailBeans, MailSenderAccountService, type MailBeans } from '../../src/features/mail/service';
import { mailSettings } from '../../src/features/mail/settings';
import { digestBeans } from '../../src/features/digest/beans';
import { testApp, type TestApp } from '../support/app';
import { mailNonceCookie, membership, oauthStates, seedOrg } from '../digest/support/seed';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const ENV = { MAIL_ENABLED: 'true', GOOGLE_MAIL_REDIRECT_URI: 'https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback', MAIL_TOKEN_ENCRYPTION_KEY: KEY };
const REFRESH_TOKEN = '1//super-secret-refresh-token';
const HOME = 'https://ceitba.org.ar/newsletter/admin/digests';
const MAIL_PAGE = 'https://ceitba.org.ar/newsletter/mine/org/sabf/mail';
const SEND_SCOPE = `openid https://www.googleapis.com/auth/userinfo.email ${SCOPE_SEND}`;

let t: TestApp;
let mail: MailBeans;
const exchanges = new Map<string, GoogleTokens>();
const revoked: string[] = [];

/** What Google's token endpoint returns for `email` (an id_token signed with some key: its signature is not checked). */
function tokensFor(email: string, scope: string, refreshToken: string | null): GoogleTokens {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = `${b64({ alg: 'HS256' })}.${b64({ iss: 'https://accounts.google.com', aud: 'test-client-id', email, email_verified: true,
    hd: 'itba.edu.ar', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
  return { accessToken: 'access', refreshToken, idToken, scope, expiresIn: 3600 };
}

beforeAll(async () => {
  t = await testApp({ env: ENV });
  mail = mailBeans(t.deps);
  mail.google.exchangeCode = async (code) => {
    const r = exchanges.get(code);
    if (!r) throw new Error('unexpected code');
    return r;
  };
  mail.google.revoke = async (token) => { revoked.push(token); };
}, 60_000);
afterAll(() => t?.close());

let staffId: string;
const bearer = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });
const callback = (q: Record<string, string>) => t.request('GET', `/v1/mail/accounts/oauth/callback?${new URLSearchParams(q)}`, { headers: mailNonceCookie(q.state) });

beforeEach(async () => {
  exchanges.clear();
  revoked.length = 0;
  await t.sql`TRUNCATE public.mail_sender_account, public.mail_account_state, public.ceitba_staff, public.user_organizations,
              public.organizations, public.digest_issues, public.mail_send_log, public."user" CASCADE`;
  staffId = await seedStaff(t.sql, 'alice@itba.edu.ar');
});

describe('MailAccountsIT (stubbed exchange)', () => {
  test('connectReturnsTheGoogleConsentUrl', async () => {
    const r = await t.request('POST', '/v1/mail/accounts/ceitba/connect', { headers: await bearer('alice@itba.edu.ar') });
    expect(r.status).toBe(200);
    for (const s of ['https://accounts.google.com/o/oauth2/v2/auth?', 'access_type=offline', 'prompt=consent', 'login_hint=ceitba@itba.edu.ar',
      'hd=itba.edu.ar', 'gmail.send%20openid%20email', 'state=']) expect(r.json.authorizationUrl).toContain(s);
  });

  test('callbackStoresTheEncryptedTokenAndListingHasNoSecrets', async () => {
    exchanges.set('good-code', tokensFor('ceitba@itba.edu.ar', SEND_SCOPE, REFRESH_TOKEN));
    const r = await callback({ code: 'good-code', state: oauthStates().issue(staffId) });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe(`${HOME}?mail=connected`);
    const [row] = await t.sql`SELECT refresh_token_enc, connected_by, scopes FROM public.mail_sender_account`;
    expect(row!.refresh_token_enc).not.toContain(REFRESH_TOKEN);
    expect(new MailTokenCipher(KEY).decrypt(row!.refresh_token_enc, 'ceitba@itba.edu.ar')).toBe(REFRESH_TOKEN);
    expect(row!.connected_by).toBe(staffId);
    expect(row!.scopes).toBe(SEND_SCOPE);
    const l = await t.request('GET', '/v1/mail/accounts', { headers: await bearer('alice@itba.edu.ar') });
    expect(l.json[0]).toMatchObject({ email: 'ceitba@itba.edu.ar', ownerType: 'ceitba', status: 'connected' });
    expect(l.json[0].refreshToken).toBeUndefined();
    expect(l.json[0].refreshTokenEnc).toBeUndefined();
    expect(l.json[0].scopes).toBeUndefined();
    expect(l.text).not.toContain(REFRESH_TOKEN);
    const q = await t.request('GET', '/v1/digests/quota', { headers: await bearer('alice@itba.edu.ar') });
    expect(q.json.senderStatus).toBe('connected');
    // A reconnect clears a transport backoff of the account.
    expect([...(await t.sql`SELECT pause_reason FROM public.mail_account_state WHERE account = 'ceitba@itba.edu.ar'`)]).toEqual([{ pause_reason: null }]);
  });

  test('callbackRejectsAnotherAccountABadStateAndAMissingScope', async () => {
    exchanges.set('alice', tokensFor('alice@itba.edu.ar', SEND_SCOPE, REFRESH_TOKEN));
    expect((await callback({ code: 'alice', state: oauthStates().issue(staffId) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=wrong_account`);
    exchanges.set('noscope', tokensFor('ceitba@itba.edu.ar', 'openid email', REFRESH_TOKEN));
    expect((await callback({ code: 'noscope', state: oauthStates().issue(staffId) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=missing_scope`);
    exchanges.set('norefresh', tokensFor('ceitba@itba.edu.ar', SEND_SCOPE, null));
    expect((await callback({ code: 'norefresh', state: oauthStates().issue(staffId) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=no_refresh_token`);
    expect((await callback({ code: 'unknown', state: oauthStates().issue(staffId) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=exchange_failed`);
    expect((await callback({ code: 'x', state: 'forged.state' })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=invalid_state`);
    const bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    expect((await callback({ code: 'x', state: oauthStates().issue(bob) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=not_staff`);
    expect((await callback({ error: 'access_denied', state: oauthStates().issue(staffId) })).headers.get('Location')).toBe(`${HOME}?mail=error&reason=access_denied`);
    expect(await t.sql`SELECT 1 FROM public.mail_sender_account`).toHaveLength(0);
    expect((await t.request('GET', '/v1/digests/quota', { headers: await bearer('alice@itba.edu.ar') })).json.senderStatus).toBe('missing');
  });

  test('testSendWithoutAConnectedSenderIs409AndDeleteRevokesAtGoogle', async () => {
    const c = await t.request('POST', '/v1/digests', { headers: await bearer('alice@itba.edu.ar'), body: { weekStart: '2026-09-28' } });
    expect(c.status).toBe(201);
    const ts = await t.request('POST', `/v1/digests/${c.json.id}/test`, { headers: await bearer('alice@itba.edu.ar') });
    expect(ts.status).toBe(409);
    expect(ts.json.error).toBe('MAIL_SENDER_NOT_CONNECTED');
    exchanges.set('c', tokensFor('ceitba@itba.edu.ar', SEND_SCOPE, REFRESH_TOKEN));
    expect((await callback({ code: 'c', state: oauthStates().issue(staffId) })).status).toBe(302);
    const [{ id }] = await t.sql`SELECT id FROM public.mail_sender_account` as unknown as [{ id: string }];
    const d = await t.request('DELETE', `/v1/mail/accounts/${id}`, { headers: await bearer('alice@itba.edu.ar') });
    expect(d.status).toBe(204);
    expect(revoked).toEqual([REFRESH_TOKEN]);
    expect(await t.sql`SELECT 1 FROM public.mail_sender_account`).toHaveLength(0);
  });

  // The read-write path (the digest worker's send transaction) does mark an undecryptable account broken.
  test('theWorkerMarksAnUndecryptableAccountBroken', async () => {
    await t.sql`INSERT INTO public.mail_sender_account (email, owner_type, refresh_token_enc, scopes) VALUES ('ceitba@itba.edu.ar', 'ceitba', 'x', 's')`;
    expect(await digestBeans(t.deps).sender.runPending()).toBeUndefined();
    // No sending issue: the worker stops before asking. Ask like it does on a tick with work.
    expect(await mail.sender.unavailableReason()).toBe(`Gmail sender account ceitba@itba.edu.ar is broken (${ERR_UNDECRYPTABLE})`);
    expect([...(await t.sql`SELECT status, last_error FROM public.mail_sender_account`)]).toEqual([{ status: 'broken', last_error: ERR_UNDECRYPTABLE }]);
  });
});

describe('OrgMailConnectIT (stubbed exchange)', () => {
  let adminId: string;
  let memberId: string;
  beforeEach(async () => {
    await seedOrg(t.sql, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(t.sql, 'trama', 'TRAMA', 'TRAMA ITBA');
    adminId = await seedUser(t.sql, 'carol@itba.edu.ar', { name: 'Carol' });
    memberId = await seedUser(t.sql, 'bea@itba.edu.ar', { name: 'Bea' });
    await membership(t.sql, adminId, 'sabf', 'admin');
    await membership(t.sql, memberId, 'sabf', 'member');
  });
  const orgTokens = (email: string) => tokensFor(email, `openid email ${SCOPE_SEND}`, '1//refresh');

  test('callbackStoresTheOrgsAccountAndRedirectsToItsMailPage', async () => {
    exchanges.set('org-code', orgTokens('sabf@itba.edu.ar'));
    const r = await callback({ code: 'org-code', state: oauthStates().issue(adminId, 'sabf') });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe(`${MAIL_PAGE}?mail=connected`);
    expect([...(await t.sql`SELECT owner_ref FROM public.mail_sender_account WHERE owner_type = 'organization' AND email = 'sabf@itba.edu.ar'`)])
      .toEqual([{ owner_ref: 'sabf' }]);
    const s = await t.request('GET', '/v1/organizations/sabf/mail', { headers: await bearer('carol@itba.edu.ar') });
    expect(s.status).toBe(200);
    expect(s.json.account).toMatchObject({ email: 'sabf@itba.edu.ar', status: 'connected' });
  });

  // OrganizationService.delete -> MailSenderAccountService.disconnectOrg: revoked at Google, then dropped.
  test('deletingTheOrgRevokesAndDropsItsGmailAccount', async () => {
    exchanges.set('org-code', orgTokens('sabf@itba.edu.ar'));
    expect((await callback({ code: 'org-code', state: oauthStates().issue(adminId, 'sabf') })).status).toBe(302);
    const d = await t.request('DELETE', '/v1/organizations/sabf', { headers: await bearer('alice@itba.edu.ar') });
    expect(d.status).toBe(204);
    expect(revoked).toEqual(['1//refresh']);
    expect(await t.sql`SELECT 1 FROM public.mail_sender_account WHERE owner_ref = 'sabf'`).toHaveLength(0);
    expect(await t.sql`SELECT 1 FROM public.organizations WHERE slug = 'sabf'`).toHaveLength(0);
  });

  test('callbackRefusesOtherDomainsNonAdminsAndAnAccountInUse', async () => {
    exchanges.set('gmail', orgTokens('sabf@gmail.com'));
    expect((await callback({ code: 'gmail', state: oauthStates().issue(adminId, 'sabf') })).headers.get('Location')).toBe(`${MAIL_PAGE}?mail=error&reason=wrong_domain`);
    expect((await callback({ code: 'x', state: oauthStates().issue(memberId, 'sabf') })).headers.get('Location')).toBe(`${MAIL_PAGE}?mail=error&reason=not_org_admin`);
    await t.sql`INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
                VALUES ('shared@itba.edu.ar', 'organization', 'trama', 'x', 'gmail.send')`;
    exchanges.set('shared', orgTokens('shared@itba.edu.ar'));
    expect((await callback({ code: 'shared', state: oauthStates().issue(adminId, 'sabf') })).headers.get('Location')).toBe(`${MAIL_PAGE}?mail=error&reason=account_in_use`);
    expect(await t.sql`SELECT 1 FROM public.mail_sender_account WHERE owner_ref = 'sabf'`).toHaveLength(0);
  });
});

describe('MailSenderAccountServiceTest', () => {
  const claims = (email: string, verified: boolean) => ({ email, emailVerified: verified, hd: 'itba.edu.ar' });
  const SENDER = 'ceitba@itba.edu.ar';

  test('onlyTheExactVerifiedSenderAddressIsAccepted', () => {
    expect(isSenderAccount(claims('ceitba@itba.edu.ar', true), SENDER)).toBe(true);
    expect(isSenderAccount(claims('CEITBA@ITBA.edu.ar', true), SENDER)).toBe(true);
    expect(isSenderAccount(claims('alice@itba.edu.ar', true), SENDER)).toBe(false);
    expect(isSenderAccount(claims('ceitba@itba.edu.ar.evil.com', true), SENDER)).toBe(false);
    expect(isSenderAccount(claims('xceitba@itba.edu.ar', true), SENDER)).toBe(false);
    expect(isSenderAccount(claims('ceitba@itba.edu.ar', false), SENDER)).toBe(false);
    expect(isSenderAccount(null, SENDER)).toBe(false);
  });

  test('sendScopeMustHaveBeenGranted', () => {
    expect(hasSendScope('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send')).toBe(true);
    expect(hasSendScope('openid email')).toBe(false);
    expect(hasSendScope(null)).toBe(false);
  });

  const service = (key: string) => {
    const s = { ...mailSettings(t.deps.config), oauth: { redirectUri: 'http://x/cb', tokenEncryptionKey: key } };
    return new MailSenderAccountService(t.deps, s, mail.google, mail.states, mail.ledger, t.deps.log);
  };

  test('anUndecryptableTokenMarksTheAccountBrokenAndReportsItUnavailable', async () => {
    const oldKey = Buffer.alloc(32).toString('base64');
    const other = Buffer.alloc(32);
    other[0] = 1;
    const newKey = other.toString('base64');
    const enc = new MailTokenCipher(oldKey).encrypt('refresh-token', SENDER); // key rotated since
    const insert = () => t.sql`INSERT INTO public.mail_sender_account (email, owner_type, refresh_token_enc, scopes) VALUES (${SENDER}, 'ceitba', ${enc}, 'scope')`;
    await insert();
    expect(await service(newKey).credentialsFor(SENDER)).toBeNull();
    expect([...(await t.sql`SELECT status, last_error FROM public.mail_sender_account`)]).toEqual([{ status: 'broken', last_error: ERR_UNDECRYPTABLE }]);
    expect(ERR_UNDECRYPTABLE).toBe('token cannot be decrypted — reconnect');
    // Same check up front (the Java mock row stays `connected`; reset it like the mock).
    await t.sql`UPDATE public.mail_sender_account SET status = 'connected', last_error = NULL`;
    expect(await service(newKey).unavailableReason(SENDER)).toContain('cannot be decrypted');
    await t.sql`UPDATE public.mail_sender_account SET status = 'connected', last_error = NULL`;
    expect((await service(oldKey).credentialsFor(SENDER))!.refreshToken).toBe('refresh-token');
    expect(await service(oldKey).unavailableReason(SENDER)).toBeNull();
  });

  test('missingOrBrokenAccountsAreUnavailable', async () => {
    expect(await service('').unavailableReason(SENDER)).toContain('no connected');
    await t.sql`INSERT INTO public.mail_sender_account (email, owner_type, refresh_token_enc, scopes, status, last_error)
                VALUES (${SENDER}, 'ceitba', 'x', 's', 'broken', 'revoked')`;
    expect(await service('').unavailableReason(SENDER)).toContain('broken');
  });
});
