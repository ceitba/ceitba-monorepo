// Ports apps/api/src/test/java/org/ceitba/api/web/orgmail/OrgMailConnectIT.java
// (same @TestPropertySource as MailAccountsIT).
//
// The IT stubs GoogleMailOAuthClient.exchangeCode; a jar would call Google.
// Black-box here: who may start the connect flow, the consent URL, and the
// callback refusals before the code exchange (not_org_admin, access_denied).
// The exchange-dependent tests (the stored org account, wrong_domain,
// account_in_use) are in-process: test/orgmail/connect.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedUser, useServer } from '../support';
import { mailNonceCookie, membership, oauthStates, seedOrg } from '../../test/digest/support/seed';

const api = useServer({ env: {
  MAIL_ENABLED: 'true',
  GOOGLE_MAIL_REDIRECT_URI: 'https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback',
  MAIL_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} });

const MAIL_PAGE = 'https://ceitba.org.ar/newsletter/mine/org/sabf/mail';
let adminId: string;
let memberId: string;

const as = async (email: string) => bearer(await mintJwt({ email, name: email }));

describe('OrgMailConnectIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public.mail_sender_account, public.user_organizations, public.organizations, public."user" CASCADE`;
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(api.db, 'trama', 'TRAMA', 'TRAMA ITBA');
    adminId = await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
    memberId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    await membership(api.db, adminId, 'sabf', 'admin');
    await membership(api.db, memberId, 'sabf', 'member');
  });

  test('onlyTheOrgsAdminsConnectAndAnyDomainAccountCanBePicked', async () => {
    expect((await api.post('/v1/organizations/sabf/mail/connect', { as: await as('alice@itba.edu.ar') })).status).toBe(403);
    const r = await api.post('/v1/organizations/sabf/mail/connect', { as: await as('carol@itba.edu.ar') });
    expect(r.status).toBe(200);
    const url: string = r.json.authorizationUrl;
    expect(url).toContain('hd=itba.edu.ar');
    expect(url).not.toContain('login_hint');
    expect(url).toMatch(/&state=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+&access_type=offline&prompt=consent&hd=itba\.edu\.ar$/);
    const state = /state=([^&]+)/.exec(url)![1]!;
    expect(oauthStates().verifyState(state)).toEqual({ userId: adminId, orgSlug: 'sabf' });
    // Not an admin of trama.
    expect((await api.post('/v1/organizations/trama/mail/connect', { as: await as('carol@itba.edu.ar') })).status).toBe(403);
    expect((await api.post('/v1/organizations/sabf/mail/connect')).status).toBe(401);
  });

  test('callbackRefusesOtherDomainsNonAdminsAndAnAccountInUse', async () => {
    const callback = (query: Record<string, string>) => api.get('/v1/mail/accounts/oauth/callback', { query, headers: mailNonceCookie(query.state) });
    const r = await callback({ code: 'x', state: oauthStates().issue(memberId, 'sabf') });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${MAIL_PAGE}?mail=error&reason=not_org_admin`);
    expect(r.headers.get('cache-control')).toBe('no-store');
    // Not in the IT: the admin declined, or no code came back.
    expect((await callback({ error: 'access_denied', state: oauthStates().issue(adminId, 'sabf') })).location)
      .toBe(`${MAIL_PAGE}?mail=error&reason=access_denied`);
    expect((await callback({ state: oauthStates().issue(adminId, 'sabf') })).location)
      .toBe(`${MAIL_PAGE}?mail=error&reason=exchange_failed`);
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.mail_sender_account WHERE owner_ref = 'sabf'` as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});
