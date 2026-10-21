// Seeding helpers for the news contract tests: the rows the Java ITs create
// through their repositories (`orgRepo.save(new Organization(...))`, ...),
// written the way Hibernate inserts them (every column, entity defaults).

import type { Sql } from 'postgres';
import { bearer, mintJwt, seedStaff, seedUser, type As } from '../../../contract/support';

export const ART_ZONE = 'America/Argentina/Buenos_Aires';

/** LocalDate.now(ClockConfig.ZONE) (+ days). */
export function artToday(plusDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ART_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + plusDays));
  return t.toISOString().slice(0, 10);
}

/** jwt().jwt(t -> t.claim("email", email).claim("name", name)) with ROLE_USER. */
export async function as(email: string, name: string = email): Promise<As> {
  return bearer(await mintJwt({ email, name }));
}

/** The ITs' staff(): boss@itba.edu.ar with ROLE_STAFF = a real active ceitba_staff row. */
export async function staff(db: Sql): Promise<As> {
  const [u] = await db`SELECT id FROM public."user" WHERE email = 'boss@itba.edu.ar'`;
  if (!u) await seedUser(db, 'boss@itba.edu.ar', { name: 'Boss' });
  await seedStaff(db, 'boss@itba.edu.ar');
  return as('boss@itba.edu.ar', 'Boss');
}

export interface OrgSeed {
  description?: string | null;
  category?: string | null;
  logoUrl?: string | null;
}

/** orgRepo.save(new Organization(slug, name, fullName)). */
export async function seedOrg(db: Sql, slug: string, name: string, fullName: string, o: OrgSeed = {}): Promise<void> {
  await db`INSERT INTO public.organizations (slug, name, full_name, description, category, color, logo_url, background_url,
             instagram, linkedin_url, website_url, contact_email, recruiting_open, recruiting_url, recruiting_text, attendees_visible_to_members)
           VALUES (${slug}, ${name}, ${fullName}, ${o.description ?? null}, ${o.category ?? null}, NULL, ${o.logoUrl ?? null}, NULL,
             NULL, NULL, NULL, NULL, false, NULL, NULL, true)`;
}

export interface ArticleSeed {
  id: string;
  title: string;
  excerpt: string;
  body: string[];
  category: string;
  authors: string[];
  status?: string;
  organization?: string | null;
  createdBy?: string | null;
  publishedAt?: string | null;
  featured?: boolean;
  coverImage?: string | null;
}

/** articleRepo.save(new Article(...)): created_at = now (distinct per row), color_scheme 'blue'. */
export async function seedArticle(db: Sql, a: ArticleSeed): Promise<void> {
  await db`INSERT INTO public.articles (id, title, excerpt, body, category, organization, authors, published_at, reading_time,
             featured, color_scheme, cover_image, status, created_at, updated_at, push_sent_at, created_by)
           VALUES (${a.id}, ${a.title}, ${a.excerpt}, ${db.json(a.body)}, ${a.category}, ${a.organization ?? null}, ${db.json(a.authors)},
             ${a.publishedAt ?? null}, NULL, ${a.featured ?? false}, 'blue', ${a.coverImage ?? null}, ${a.status ?? 'published'},
             clock_timestamp(), clock_timestamp(), NULL, ${a.createdBy ?? null})`;
}

export interface EventSeed {
  id: string;
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  category: string;
  organization?: string | null;
  signupMode?: string;
  capacity?: number | null;
  description?: string | null;
}

/** eventRepo.save(new NewsEvent(...)). */
export async function seedEvent(db: Sql, e: EventSeed): Promise<void> {
  await db`INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category, organization, description,
             created_at, created_by, cover_image, online_url, signup_mode, signup_url, capacity, reminder_sent_at)
           VALUES (${e.id}, ${e.title}, ${e.eventDate}, ${e.startTime}, ${e.endTime}, ${e.location}, ${e.category}, ${e.organization ?? null},
             ${e.description ?? null}, clock_timestamp(), NULL, NULL, NULL, ${e.signupMode ?? 'none'}, NULL, ${e.capacity ?? null}, NULL)`;
}

/** membershipRepo.save(new UserOrganization(userId, org, role)). */
export async function seedMembership(db: Sql, userId: string, org: string, role: string): Promise<void> {
  await db`INSERT INTO public.user_organizations (user_id, org_slug, role, added_by, title, show_on_portal, created_at)
           VALUES (${userId}, ${org}, ${role}, NULL, NULL, false, clock_timestamp())`;
}

export async function seedFollow(db: Sql, userId: string, org: string): Promise<void> {
  await db`INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (${userId}, ${org}, clock_timestamp())`;
}

/** The ITs' deleteAll() chain: content, memberships, users, organizations. */
export async function wipeNews(db: Sql): Promise<void> {
  await db`DELETE FROM public.analytics_events`;
  await db`DELETE FROM public.event_rsvps`;
  await db`DELETE FROM public.vote_records`;
  await db`DELETE FROM public.article_votes`;
  await db`DELETE FROM public.articles`;
  await db`DELETE FROM public.news_events`;
  await db`DELETE FROM public.org_invites`;
  await db`DELETE FROM public.user_organizations`;
  await db`DELETE FROM public.user_follows`;
  await db`DELETE FROM public.push_log`;
  await db`TRUNCATE public."user" CASCADE`;
  await db`DELETE FROM public.organizations`;
}

export async function roleOf(db: Sql, userId: string, org: string): Promise<string | null> {
  const [r] = await db`SELECT role FROM public.user_organizations WHERE user_id = ${userId} AND org_slug = ${org}`;
  return (r?.role as string) ?? null;
}
