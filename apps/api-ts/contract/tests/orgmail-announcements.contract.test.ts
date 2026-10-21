// Ports apps/api/src/test/java/org/ceitba/api/web/orgmail/OrgMailIT.java.
//
// The test config's transport is the log-only one (MAIL_LOG_SENDS=true,
// MAIL_ENABLED=false): sends "succeed" without leaving the process. The IT
// calls OrgAnnouncementSender.runPending(); black-box, the worker OrgMailJob
// kicks after a send commits does it (ORG_MAIL_JOBS_ENABLED on the second
// server) and the test polls. pendingDeliveriesWaitForTheOrgsAccount...
// needs the deliveries to stay pending while the account is gone, which the
// immediate kick races: in-process, test/orgmail/sender.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type Server } from '../support';
import { eventually, membership, orgUnsubscribeToken, seedOrg } from '../../test/digest/support/seed';

const api = useServer();
const worker = useServer({ env: { ORG_MAIL_JOBS_ENABLED: 'true', ORG_MAIL_TICK_INTERVAL: 'PT1H' } });

interface Ids { adminId: string; memberId: string; bobId: string; daveId: string }

async function seed(s: Server): Promise<Ids> {
  const db = s.db;
  await db`TRUNCATE public.mail_sender_account, public.mail_account_state, public.mail_send_log,
           public.org_announcements, public.org_mail_optouts, public.user_follows, public.user_organizations,
           public.organizations, public."user" CASCADE`;
  await seedOrg(db, 'sabf', 'SABF', 'South American Business Forum');
  await seedOrg(db, 'trama', 'TRAMA', 'TRAMA ITBA');
  const adminId = await seedUser(db, 'carol@itba.edu.ar', { name: 'Carol' });
  const memberId = await seedUser(db, 'alice@itba.edu.ar', { name: 'Alice' });
  const bobId = await seedUser(db, 'bob@itba.edu.ar', { name: 'Bob' });
  const daveId = await seedUser(db, 'dave@itba.edu.ar', { name: 'Dave' });
  const outsider = await seedUser(db, 'eve@gmail.com', { name: 'Eve' });
  await membership(db, adminId, 'sabf', 'admin');
  await membership(db, memberId, 'sabf', 'member');
  for (const u of [bobId, daveId, outsider]) await db`INSERT INTO public.user_follows (user_id, org_slug) VALUES (${u}, 'sabf')`;
  // Dave opted out; Eve is outside the allowed domains.
  await db`INSERT INTO public.org_mail_optouts (user_id, org_slug) VALUES (${daveId}, 'sabf')`;
  return { adminId, memberId, bobId, daveId };
}

const as = async (email: string) => bearer(await mintJwt({ email, name: email }));
const admin = () => as('carol@itba.edu.ar');
const member = () => as('alice@itba.edu.ar');

async function connectedAccount(s: Server, email: string) {
  await s.db`INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes)
             VALUES (${email}, 'organization', 'sabf', 'x', 'gmail.send')`;
}

async function draft(s: Server, subject: string): Promise<number> {
  const r = await s.post('/v1/organizations/sabf/announcements', { as: await admin(), body: { subject, body: 'Hola!\n\nInscribite en https://sabf.org.ar' } });
  expect(r.status).toBe(201);
  return r.json.id;
}

describe('OrgMailIT', () => {
  let ids: Ids;
  beforeEach(async () => { ids = await seed(api); });

  test('anOrgSendsAtMostTheWeeklyLimitAndOnlyAdminsManageEmails', async () => {
    await connectedAccount(api, 'sabf@itba.edu.ar');
    const first = await draft(api, 'Primera');
    // org-mail.weekly-limit defaults to 3.
    for (const subject of ['Segunda', 'Tercera']) {
      const id = await draft(api, subject);
      expect((await api.post(`/v1/organizations/sabf/announcements/${id}/send`, { as: await admin() })).status).toBe(200);
    }
    expect((await api.post(`/v1/organizations/sabf/announcements/${first}/send`, { as: await admin() })).status).toBe(200);
    const fourth = await draft(api, 'Cuarta');
    const limit = await api.post(`/v1/organizations/sabf/announcements/${fourth}/send`, { as: await admin() });
    expect(limit.status).toBe(409);
    expect(limit.json.error).toBe('OrgMailWeeklyLimit');
    expect(limit.json.message).toBe('The organization already sent its emails for this week');
    const again = await api.post(`/v1/organizations/sabf/announcements/${first}/send`, { as: await admin() });
    expect(again.json.error).toBe('OrgMailNotDraft');
    expect(again.json.message).toBe('Only drafts can be changed or sent');

    expect((await api.get('/v1/organizations/sabf/announcements', { as: await member() })).status).toBe(403);
    expect((await api.get('/v1/organizations/sabf/mail', { as: await member() })).status).toBe(403);
  });

  test('oneClickUnsubscribeOptsOutOfThatOrgOnly', async () => {
    const r = await api.post('/v1/org-mail/unsubscribe', { query: { token: orgUnsubscribeToken(ids.bobId, 'sabf') } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"organization":"SABF"}');
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.org_mail_optouts WHERE user_id = ${ids.bobId}` as unknown as [{ n: number }];
    expect(n).toBe(1);

    const forged = orgUnsubscribeToken(ids.bobId, 'sabf').replace('.sabf.', '.trama.');
    const bad = await api.post('/v1/org-mail/unsubscribe', { query: { token: forged } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('ValidationError');
    expect(bad.json.message).toBe("Validation failed for field 'token' with value 'null': is not a valid unsubscribe token");
    // Idempotent; a missing token is the same 400.
    expect((await api.post('/v1/org-mail/unsubscribe', { query: { token: orgUnsubscribeToken(ids.bobId, 'sabf') } })).status).toBe(200);
    expect((await api.post('/v1/org-mail/unsubscribe')).status).toBe(400);
  });

  test('followersSwitchAnOrgsEmailsOnAndOff', async () => {
    const bob = await as('bob@itba.edu.ar');
    const off = await api.put('/v1/me/follows/sabf/mail', { as: bob, body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.text).toBe('{"enabled":false}');
    expect((await api.get('/v1/me/follows/sabf/mail', { as: bob })).json.enabled).toBe(false);
    expect((await api.put('/v1/me/follows/sabf/mail', { as: bob, body: { enabled: true } })).status).toBe(200);
    const on = await api.get('/v1/me/follows/sabf/mail', { as: bob });
    expect(on.text).toBe('{"enabled":true}');
    // Not in the IT: unknown org on PUT is 404, GET answers for any slug; body validation.
    const nf = await api.put('/v1/me/follows/nope/mail', { as: bob, body: { enabled: false } });
    expect(nf.status).toBe(404);
    expect(nf.json.message).toBe("Organization with identifier 'nope' not found");
    expect((await api.get('/v1/me/follows/nope/mail', { as: bob })).text).toBe('{"enabled":true}');
    const v = await api.put('/v1/me/follows/sabf/mail', { as: bob, body: {} });
    expect(v.status).toBe(400);
    expect(v.json.message).toBe('enabled: must not be null');
    expect((await api.get('/v1/me/follows/sabf/mail')).status).toBe(401);
  });

  // Not in the IT: drafts are edited and deleted by admins (and STAFF); not after sending.
  test('draftsAreEditedAndDeletedOnlyWhileDrafts', async () => {
    const id = await draft(api, 'Borrador');
    const created = await api.get('/v1/organizations/sabf/announcements', { as: await admin() });
    expect(created.status).toBe(200);
    expect(Object.keys(created.json[0])).toEqual(['id', 'subject', 'body', 'status', 'recipientCount', 'sent', 'failed', 'pending',
      'createdAt', 'sentAt', 'finishedAt']);
    expect(created.text).toContain(`{"id":${id},"subject":"Borrador","body":"Hola!\\n\\nInscribite en https://sabf.org.ar","status":"draft","recipientCount":null,"sent":0,"failed":0,"pending":0,"createdAt":"`);
    expect(created.json[0].createdAt).toMatch(/Z$/);

    const p = await api.patch(`/v1/organizations/sabf/announcements/${id}`, { as: await admin(), body: { subject: '  Nuevo  ' } });
    expect(p.status).toBe(200);
    expect(p.json.subject).toBe('Nuevo');
    expect(p.json.body).toBe('Hola!\n\nInscribite en https://sabf.org.ar');
    const bad = await api.patch(`/v1/organizations/sabf/announcements/${id}`, { as: await admin(), body: { subject: 'a\nb' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('ValidationError');
    expect(bad.json.message).toBe("Validation failed for field 'subject' with value 'a\nb': must be one line of 1-150 characters");
    const empty = await api.post('/v1/organizations/sabf/announcements', { as: await admin(), body: { subject: 'x', body: '  ' } });
    expect(empty.status).toBe(400);
    expect(empty.json.message).toBe("Validation failed for field 'body' with value 'null': must be 1-20000 characters");
    const nf = await api.patch('/v1/organizations/sabf/announcements/999999', { as: await admin(), body: { subject: 'x' } });
    expect(nf.status).toBe(404);
    expect(nf.json.message).toBe("OrgAnnouncement with identifier '999999' not found");
    // Another org's id is not found through this org.
    expect((await api.patch(`/v1/organizations/trama/announcements/${id}`, { as: await admin(), body: { subject: 'x' } })).status).toBe(403);
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const staff = await as('boss@itba.edu.ar');
    expect((await api.patch(`/v1/organizations/trama/announcements/${id}`, { as: staff, body: { subject: 'x' } })).status).toBe(404);
    expect((await api.get('/v1/organizations/nope/announcements', { as: staff })).status).toBe(404);
    expect((await api.get('/v1/organizations/sabf/announcements', { as: staff })).status).toBe(200);

    await connectedAccount(api, 'sabf@itba.edu.ar');
    const sent = await draft(api, 'Enviado');
    const s = await api.post(`/v1/organizations/sabf/announcements/${sent}/send`, { as: await admin() });
    expect(s.status).toBe(200);
    expect(s.json.sentAt).toMatch(/-03:00$/);
    expect(s.json.pending).toBe(1);
    const nd = await api.delete(`/v1/organizations/sabf/announcements/${sent}`, { as: await admin() });
    expect(nd.status).toBe(409);
    expect(nd.json.error).toBe('OrgMailNotDraft');
    expect((await api.patch(`/v1/organizations/sabf/announcements/${sent}`, { as: await admin(), body: { body: 'x' } })).json.error).toBe('OrgMailNotDraft');

    const d = await api.delete(`/v1/organizations/sabf/announcements/${id}`, { as: await admin() });
    expect(d.status).toBe(204);
    expect((await api.delete(`/v1/organizations/sabf/announcements/${id}`, { as: await admin() })).status).toBe(404);
    expect((await api.delete(`/v1/organizations/sabf/announcements/${id}`, { as: await member() })).status).toBe(403);
  });

  // Not in the IT: the status page and disconnecting the account.
  test('statusAndDisconnect', async () => {
    const none = await api.get('/v1/organizations/sabf/mail', { as: await admin() });
    expect(none.status).toBe(200);
    expect(none.text).toBe('{"account":null,"mailEnabled":true,"quota":null,"weeklyLimit":3,"sentThisWeek":0,"recipientEstimate":1,"allowedDomain":"itba.edu.ar"}');
    await connectedAccount(api, 'sabf@itba.edu.ar');
    const st = await api.get('/v1/organizations/sabf/mail', { as: await admin() });
    expect(st.status).toBe(200);
    expect(Object.keys(st.json)).toEqual(['account', 'mailEnabled', 'quota', 'weeklyLimit', 'sentThisWeek', 'recipientEstimate', 'allowedDomain']);
    expect(st.json.account.email).toBe('sabf@itba.edu.ar');
    expect(st.json.account.ownerType).toBe('organization');
    expect(st.json.account.ownerRef).toBe('sabf');
    expect(st.text).toContain('"quota":{"account":"sabf@itba.edu.ar","limit":400,"usedLast24h":0,"remaining":400,"pausedUntil":null,"pauseReason":null,"nextCapacityAt":null}');
    expect((await api.get('/v1/organizations/nope/mail', { as: await admin() })).status).toBe(403);

    // Connect needs MAIL_TOKEN_ENCRYPTION_KEY: 501 here.
    const c = await api.post('/v1/organizations/sabf/mail/connect', { as: await admin() });
    expect(c.status).toBe(501);
    expect(c.json.error).toBe('NotImplemented');
    expect(c.json.message).toBe('MAIL_TOKEN_ENCRYPTION_KEY is not set (openssl rand -base64 32)');

    const d = await api.delete('/v1/organizations/sabf/mail', { as: await admin() });
    expect(d.status).toBe(204);
    expect((await api.db`SELECT 1 FROM public.mail_sender_account`).length).toBe(0);
    // No account: a no-op.
    expect((await api.delete('/v1/organizations/sabf/mail', { as: await admin() })).status).toBe(204);
    expect((await api.delete('/v1/organizations/sabf/mail', { as: await member() })).status).toBe(403);
  });
});

describe('OrgMailIT (sending worker)', () => {
  let ids: Ids;
  beforeEach(async () => { ids = await seed(worker); });

  test('sendingReachesFollowersWhoDidntOptOutWithinTheAllowedDomains', async () => {
    const id = await draft(worker, 'Convocatoria');
    const nc = await worker.post(`/v1/organizations/sabf/announcements/${id}/send`, { as: await admin() });
    expect(nc.status).toBe(409);
    expect(nc.json.error).toBe('OrgMailNotConnected');
    expect(nc.json.message).toBe('The organization has no connected Gmail account');

    await connectedAccount(worker, 'sabf@itba.edu.ar');
    // Counted in SQL with the same rule as the send: Dave opted out, Eve is outside the domains.
    expect((await worker.get('/v1/organizations/sabf/mail', { as: await admin() })).json.recipientEstimate).toBe(1);
    const t = await worker.post(`/v1/organizations/sabf/announcements/${id}/test`, { as: await admin() });
    expect(t.status).toBe(204);
    const s = await worker.post(`/v1/organizations/sabf/announcements/${id}/send`, { as: await admin() });
    expect(s.status).toBe(200);
    expect(s.json.status).toBe('sending');
    expect(s.json.recipientCount).toBe(1);

    await eventually(async () => (await worker.get('/v1/organizations/sabf/announcements', { as: await admin() })).json?.[0]?.status === 'sent',
      20_000, 'the announcement to be sent');
    const l = await worker.get('/v1/organizations/sabf/announcements', { as: await admin() });
    expect(l.json[0].status).toBe('sent');
    expect(l.json[0].sent).toBe(1);
    expect(l.json[0].finishedAt).toMatch(/Z$/);
    const [{ n }] = await worker.db`SELECT count(*)::int AS n FROM public.org_announcement_deliveries WHERE user_id = ${ids.bobId} AND status = 'sent'` as unknown as [{ n: number }];
    expect(n).toBe(1);
    // Test and announcement both count toward the org account's quota, not CEITBA's.
    const [{ m }] = await worker.db`SELECT count(*)::int AS m FROM public.mail_send_log WHERE account = 'sabf@itba.edu.ar'` as unknown as [{ m: number }];
    expect(m).toBe(2);
    const kinds = (await worker.db`SELECT kind FROM public.mail_send_log ORDER BY id`).map((r) => r.kind);
    expect(kinds).toEqual(['test', 'org']);
  });
});
