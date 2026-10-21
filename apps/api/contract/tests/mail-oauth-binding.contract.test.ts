// Intentional hardening vs the Java app (contract/COMPATIBILITY.md "Mail OAuth state"): the sender-account connect
// flow's `state` is bound to the browser that started it. The connect call sets an HttpOnly nonce cookie scoped to
// the callback; the callback refuses (invalid_state, nothing stored, no code exchange) a state that arrives without
// that cookie, so an org admin cannot send the consent URL to someone else and connect their mailbox. TS-only.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedUser, TARGET, useServer } from '../support';
import { membership, seedOrg } from '../../test/digest/support/seed';

const api = useServer({ env: {
  MAIL_ENABLED: 'true',
  GOOGLE_MAIL_REDIRECT_URI: 'https://ceitba.org.ar/api/v1/mail/accounts/oauth/callback',
  MAIL_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} });
const MAIL_PAGE = 'https://ceitba.org.ar/newsletter/mine/org/sabf/mail';
const admin = async () => bearer(await mintJwt({ email: 'carol@itba.edu.ar', name: 'Carol' }));

describe.skipIf(TARGET === 'java')('MailOAuthBrowserBinding (TS hardening)', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public.mail_sender_account, public.user_organizations, public.organizations, public."user" CASCADE`;
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await membership(api.db, await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' }), 'sabf', 'admin');
  });

  test('connectSetsAnHttpOnlyNonceCookieScopedToTheCallback', async () => {
    const r = await api.post('/v1/organizations/sabf/mail/connect', { as: await admin() });
    expect(r.status).toBe(200);
    const cookie = r.setCookies.find((c) => c.startsWith('ceitba_mail_oauth_nonce='))!;
    expect(cookie).toMatch(/^ceitba_mail_oauth_nonce=[A-Za-z0-9_-]+; Path=\/api\/v1\/mail\/accounts\/oauth\/callback; Max-Age=600; Expires=[^;]+; (Secure; )?HttpOnly; SameSite=Lax$/);
    const nonce = /=([^;]+)/.exec(cookie)![1]!;
    const state = decodeURIComponent(/state=([^&]+)/.exec(r.json.authorizationUrl)![1]!);
    expect(Buffer.from(state.split('.')[0]!, 'base64url').toString('utf8').split('|')[2]).toBe(nonce);
  });

  test('aStateOpenedInAnotherBrowserIsRefused', async () => {
    const r = await api.post('/v1/organizations/sabf/mail/connect', { as: await admin() });
    const state = decodeURIComponent(/state=([^&]+)/.exec(r.json.authorizationUrl)![1]!);
    const nonce = /ceitba_mail_oauth_nonce=([^;]+)/.exec(r.setCookies.join('\n'))![1]!;
    // The victim's browser: no cookie, or another connect's cookie.
    for (const headers of [{}, { Cookie: 'ceitba_mail_oauth_nonce=someone-elses-nonce' }] as Record<string, string>[]) {
      const cb = await api.get('/v1/mail/accounts/oauth/callback', { query: { error: 'access_denied', state }, headers });
      expect(cb.status).toBe(302);
      expect(cb.location).toBe('https://ceitba.org.ar/newsletter/admin/digests?mail=error&reason=invalid_state');
    }
    // The admin's own browser gets past the state check (here to the declined-consent refusal).
    const own = await api.get('/v1/mail/accounts/oauth/callback', { query: { error: 'access_denied', state }, headers: { Cookie: `ceitba_mail_oauth_nonce=${nonce}` } });
    expect(own.location).toBe(`${MAIL_PAGE}?mail=error&reason=access_denied`);
    expect(own.setCookies.some((c) => c.startsWith('ceitba_mail_oauth_nonce=;') && c.includes('Max-Age=0'))).toBe(true);
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.mail_sender_account` as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});
