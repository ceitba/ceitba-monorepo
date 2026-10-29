// Seeding helpers shared by the digest / mail / orgmail contract and
// in-process tests: the JPA saves of the Java ITs as plain SQL.
import type { Sql } from 'postgres';
import { TEST_JWT_SECRET } from '../../../contract/support/env';
import { ContentHmac } from '../../../src/features/crypto/logic/contentHmac';
import { DigestCorrectionVoteTokens } from '../../../src/features/digest/logic/digestCorrectionVoteTokens';
import { DigestUnsubscribeTokens } from '../../../src/features/digest/logic/digestUnsubscribeTokens';
import { MAIL_OAUTH_NONCE_COOKIE, MailOAuthStateService, stateNonce } from '../../../src/features/mail/logic/mailOAuthState';
import { MutableClock, SystemClock, type Clock } from '../../../src/infra/clock';
import { systemNowMicros } from '../../../src/lib/time';

/** The servers' ContentHmac (CONTENT_HMAC_SECRET unset: derived from the test JWT secret). */
export const testHmac = () => ContentHmac.fromJwtSecret(TEST_JWT_SECRET);
export const unsubscribeTokens = () => new DigestUnsubscribeTokens(testHmac());
export const voteTokens = (clock: Clock = new SystemClock(), ttlMs = 14 * 86_400_000) =>
  new DigestCorrectionVoteTokens(testHmac(), clock, ttlMs);
/** A vote token minted `daysAgo` days in the past (its 14-day TTL counted from then). */
export const pastVoteTokens = (daysAgo: number) =>
  voteTokens(new MutableClock(systemNowMicros() - daysAgo * 86_400_000_000));
export const oauthStates = () => new MailOAuthStateService(TEST_JWT_SECRET, new SystemClock());

/** The browser-binding cookie the connect call would have set for `state` (empty when the state has no nonce). */
export function mailNonceCookie(state: string | undefined): Record<string, string> {
  const nonce = stateNonce(state);
  return nonce == null ? {} : { Cookie: `${MAIL_OAUTH_NONCE_COOKIE}=${nonce}` };
}

/** OrgMailUnsubscribeTokens.issue */
export function orgUnsubscribeToken(userId: string, slug: string): string {
  const mac = testHmac().sign('org-mail-unsubscribe', `org-mail-unsubscribe:v1:${userId}:${slug}`);
  return `${userId}.${slug}.${Buffer.from(mac).toString('base64url')}`;
}

export async function seedOrg(db: Sql, slug: string, name: string, fullName: string): Promise<void> {
  await db`INSERT INTO public.organizations (slug, name, full_name, recruiting_open, attendees_visible_to_members)
           VALUES (${slug}, ${name}, ${fullName}, false, true)`;
}

export async function follow(db: Sql, userId: string, slug: string): Promise<void> {
  await db`INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (${userId}, ${slug}, now())`;
}

/** new Article(id, "Título " + id, "Resumen", ["p"], "general", ["Autor"]) + org/publishedAt/status. */
export async function seedArticle(db: Sql, id: string, org: string | null, publishedAt: string, status: string): Promise<void> {
  await db`INSERT INTO public.articles (id, title, excerpt, body, category, organization, published_at, status, authors,
                                        featured, color_scheme, created_at, updated_at)
           VALUES (${id}, ${`Título ${id}`}, 'Resumen', ${db.json(['p'])}, 'general', ${org}, ${publishedAt}, ${status},
                   ${db.json(['Autor'])}, false, 'blue', now(), now())`;
}

/** new NewsEvent(id, "Evento " + id, date, 18:00, 20:00, "Aula 101", "general") + org. */
export async function seedEvent(db: Sql, id: string, org: string | null, date: string, createdAt?: string): Promise<void> {
  await db`INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category, organization,
                                           signup_mode, created_at)
           VALUES (${id}, ${`Evento ${id}`}, ${date}, '18:00', '20:00', 'Aula 101', 'general', ${org}, 'none',
                   ${createdAt ?? null}::timestamptz)`;
  if (createdAt === undefined) await db`UPDATE public.news_events SET created_at = now() WHERE id = ${id}`;
}

export async function setCapabilityOpen(db: Sql, capability: string, open: boolean): Promise<void> {
  await db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES (${capability}, ${open})
           ON CONFLICT (capability) DO UPDATE SET enabled_for_all = EXCLUDED.enabled_for_all`;
}

export async function membership(db: Sql, userId: string, slug: string, role: string): Promise<void> {
  await db`INSERT INTO public.user_organizations (user_id, org_slug, role) VALUES (${userId}, ${slug}, ${role})`;
}

/** Polls `probe` until it returns true (the background worker finished), or fails after `ms`. */
export async function eventually(probe: () => Promise<boolean>, ms = 20_000, what = 'condition'): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(100);
  }
}
