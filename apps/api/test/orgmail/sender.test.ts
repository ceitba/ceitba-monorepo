// In-process port of OrgMailIT.pendingDeliveriesWaitForTheOrgsAccountAndResumeFromTheNewOne
// (apps/api/src/test/java/org/ceitba/api/web/orgmail/OrgMailIT.java): the IT drives
// OrgAnnouncementSender.runPending() between account changes, which a black-box
// worker kicked right after the send would race.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mintJwt, seedUser } from '../../contract/support';
import { orgMailBeans } from '../../src/features/orgmail/beans';
import { testApp, type TestApp } from '../support/app';
import { membership, seedOrg } from '../digest/support/seed';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

test('pendingDeliveriesWaitForTheOrgsAccountAndResumeFromTheNewOne', async () => {
  const db = t.sql;
  await seedOrg(db, 'sabf', 'SABF', 'South American Business Forum');
  const admin = await seedUser(db, 'carol@itba.edu.ar', { name: 'Carol' });
  const bob = await seedUser(db, 'bob@itba.edu.ar', { name: 'Bob' });
  await membership(db, admin, 'sabf', 'admin');
  await db`INSERT INTO public.user_follows (user_id, org_slug) VALUES (${bob}, 'sabf')`;
  const connected = (email: string) => db`INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
                                          VALUES (${email}, 'organization', 'sabf', 'x', 'gmail.send')`;
  const auth = { Authorization: `Bearer ${await mintJwt({ email: 'carol@itba.edu.ar', name: 'Carol' })}` };
  await connected('sabf@itba.edu.ar');
  const d = await t.request('POST', '/v1/organizations/sabf/announcements', { headers: auth, body: { subject: 'Convocatoria', body: 'Hola!' } });
  expect(d.status).toBe(201);
  expect((await t.request('POST', `/v1/organizations/sabf/announcements/${d.json.id}/send`, { headers: auth })).status).toBe(200);
  await db`DELETE FROM public.mail_sender_account WHERE owner_ref = 'sabf'`;

  const sender = orgMailBeans(t.deps).sender;
  await sender.runPending();
  let l = await t.request('GET', '/v1/organizations/sabf/announcements', { headers: auth });
  expect(l.json[0]).toMatchObject({ status: 'sending', pending: 1 });

  await connected('prensa.sabf@itba.edu.ar');
  await sender.runPending();
  l = await t.request('GET', '/v1/organizations/sabf/announcements', { headers: auth });
  expect(l.json[0]).toMatchObject({ status: 'sent', sent: 1 });
  expect((await db`SELECT count(*)::int AS n FROM public.mail_send_log WHERE account = 'prensa.sabf@itba.edu.ar'`)[0]!.n).toBe(1);
});
