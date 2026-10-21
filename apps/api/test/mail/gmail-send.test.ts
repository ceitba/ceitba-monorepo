// The Gmail API transport end to end against the database (the Java side has
// GmailApiEmailSenderTest with mocks, ported in GmailApiEmailSender.test.ts):
// credentials from mail_sender_account, refresh, send, markUsed / markBroken.
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mailBeans } from '../../src/features/mail/service';
import { GmailApiEmailSender, type GmailHttp } from '../../src/features/mail/logic/gmailApiEmailSender';
import { MailAccessTokenCache } from '../../src/features/mail/logic/mailAccessTokenCache';
import { MailTokenCipher } from '../../src/features/mail/logic/mailTokenCipher';
import { GoogleOAuthError } from '../../src/features/mail/logic/types';
import { EmailSendError } from '../../src/infra/mail';
import { testApp, type TestApp } from '../support/app';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
let t: TestApp;
beforeAll(async () => { t = await testApp({ env: { MAIL_ENABLED: 'true', MAIL_TOKEN_ENCRYPTION_KEY: KEY } }); }, 60_000);
afterAll(() => t?.close());

let refreshes: number;
let refreshError: GoogleOAuthError | null;

function sender(answers: { status: number; body: string }[]) {
  const queue = [...answers];
  const fake: GmailHttp = async () => {
    const a = queue.shift() ?? { status: 200, body: '{"id":"m"}' };
    return { ...a, retryAfter: null };
  };
  const tokens = new MailAccessTokenCache(async () => {
    refreshes++;
    if (refreshError) throw refreshError;
    return { accessToken: `at-${refreshes}`, refreshToken: null, idToken: null, scope: null, expiresIn: 3600 };
  }, t.deps.clock);
  return new GmailApiEmailSender(mailBeans(t.deps).accounts, tokens, 'CEITBA <ceitba@itba.edu.ar>', fake);
}

const email = { to: 'a@itba.edu.ar', subject: 'Hola', html: '<p>x</p>', text: 'x', headers: {}, kind: 'test' };
const row = async () => (await t.sql`SELECT status, last_error, last_used_at FROM public.mail_sender_account`)[0]!;

beforeEach(async () => {
  refreshes = 0;
  refreshError = null;
  await t.sql`TRUNCATE public.mail_sender_account`;
  const enc = new MailTokenCipher(KEY).encrypt('1//refresh', 'ceitba@itba.edu.ar');
  await t.sql`INSERT INTO public.mail_sender_account (email, owner_type, refresh_token_enc, scopes) VALUES ('ceitba@itba.edu.ar', 'ceitba', ${enc}, 's')`;
});

test('sendsWithTheStoredRefreshTokenAndMarksTheAccountUsed', async () => {
  await sender([]).send(email);
  expect(refreshes).toBe(1);
  const r = await row();
  expect(r.status).toBe('connected');
  expect(r.last_used_at).not.toBeNull();
});

test('a401RetriesOnceWithAFreshAccessToken', async () => {
  await sender([{ status: 401, body: '{}' }]).send(email);
  expect(refreshes).toBe(2);
  expect((await row()).status).toBe('connected');
});

test('aSecond401MarksTheAccountBroken', async () => {
  const e = await sender([{ status: 401, body: '{}' }, { status: 401, body: '{}' }]).send(email).catch((x) => x);
  expect(e).toBeInstanceOf(EmailSendError);
  expect((e as EmailSendError).kind).toBe('TRANSPORT');
  expect(await row()).toMatchObject({ status: 'broken', last_error: 'Gmail API HTTP 401 (authorization problem)' });
});

test('invalidGrantMarksTheAccountBroken', async () => {
  refreshError = new GoogleOAuthError('INVALID_GRANT', 'Google token endpoint: invalid_grant');
  const e = await sender([]).send(email).catch((x) => x);
  expect((e as EmailSendError).kind).toBe('TRANSPORT');
  expect(await row()).toMatchObject({ status: 'broken', last_error: 'Google rejected the stored token (invalid_grant): reconnect the account' });
});
