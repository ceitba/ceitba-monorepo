// In-process port of MailTrackingIT.retentionDeletesOldTrackingAndSendLogRowsOnly
// (apps/api/src/test/java/org/ceitba/api/web/mail/MailTrackingIT.java): it calls
// MailRetentionService.cleanup(), whose job only runs nightly.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { seedStaff, seedUser } from '../../contract/support';
import { digestBeans } from '../../src/features/digest/beans';
import { mailBeans } from '../../src/features/mail/service';
import { testApp, type TestApp } from '../support/app';
import { follow, seedArticle, seedOrg, setCapabilityOpen } from '../digest/support/seed';

let t: TestApp;
beforeAll(async () => { t = await testApp({ env: { MAIL_DAILY_LIMIT: '3' } }); }, 60_000);
afterAll(() => t?.close());

test('retentionDeletesOldTrackingAndSendLogRowsOnly', async () => {
  const db = t.sql;
  await setCapabilityOpen(db, 'resumen_semanal', true);
  await seedOrg(db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
  const alice = await seedStaff(db, 'alice@itba.edu.ar');
  const bob = await seedUser(db, 'bob@itba.edu.ar', { name: 'Bob' });
  await follow(db, alice, 'ceitba');
  await follow(db, bob, 'ceitba');
  await seedArticle(db, 'a-ceitba', 'ceitba', '2026-09-30', 'published');
  const b = digestBeans(t.deps);
  const d = await b.service.create({ weekStart: '2026-09-28', autoSendAt: null });
  await b.service.send(d.id, alice);
  await b.sender.runPending(); // logging transport: nothing leaves the process
  const id = d.id;

  const [{ tracking_id: tid }] = await db`SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ${id} AND status = 'sent' LIMIT 1` as unknown as [{ tracking_id: string }];
  const [{ tracking_id: other }] = await db`SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ${id} AND status = 'sent' AND tracking_id <> ${tid}` as unknown as [{ tracking_id: string }];
  const [{ n: before }] = await db`SELECT COUNT(*)::int AS n FROM public.mail_send_log` as unknown as [{ n: number }];
  await db`INSERT INTO public.mail_send_log (account, kind, recipients, outcome, attempted_at) VALUES ('x@itba.edu.ar', 'digest', 1, 'sent', now() - interval '40 days')`;
  await db`INSERT INTO public.mail_tracking_event (tracking_id, type, at, ua_class) VALUES (${tid}, 'open', now() - interval '200 days', 'browser')`;
  await db`INSERT INTO public.mail_tracking_event (tracking_id, type, at, ua_class) VALUES (${tid}, 'open', now() - interval '10 days', 'browser')`;
  // tid was sent 200 days ago, `other` just now: only tid's per-delivery links go.
  await db`UPDATE public.digest_deliveries SET sent_at = now() - interval '200 days' WHERE tracking_id = ${tid}`;
  for (const x of [tid, other]) {
    await db`INSERT INTO public.digest_delivery_links (tracking_id, link_id, url, url_key, label) VALUES (${x}, 1000, 'https://ceitba.org.ar/x', 'https://ceitba.org.ar/x', 'x')`;
  }

  await mailBeans(t.deps).retention.cleanup();

  expect((await db`SELECT COUNT(*)::int AS n FROM public.mail_send_log`)[0]!.n).toBe(before);
  expect((await db`SELECT COUNT(*)::int AS n FROM public.mail_tracking_event WHERE tracking_id = ${tid}`)[0]!.n).toBe(1);
  expect((await db`SELECT tracking_id FROM public.digest_delivery_links`).map((r) => r.tracking_id)).toEqual([other]);
  expect((await db`SELECT COUNT(*)::int AS n FROM public.digest_deliveries WHERE tracking_id = ${tid}`)[0]!.n).toBe(1);
});
