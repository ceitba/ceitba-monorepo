// The sync feature's SQL: the Firestore import's user, moderator, benefit and catalogue rows, the
// proposal import's rows (ProposalImportRepository / UserRepository lookups) and the data sync's
// career/plan lists. Every function takes the caller's transaction.

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { toPgTimestamp } from '../../lib/time';
import type { ImportUsers, ProposalImportRows } from './proposalImporter';

export type Row = Record<string, unknown>;

const rowsOf = async (db: Db, q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

// ---- users (Firestore users/) -------------------------------------------------------------

const USER_COLUMNS = sql`id, email, name, firebase_uid, career_id, plan, linkedin, instagram, discord`;

export const userByFirebaseUid = async (db: Db, uid: string): Promise<Row | null> =>
  (await rowsOf(db, sql`SELECT ${USER_COLUMNS}
    FROM public."user" WHERE firebase_uid = ${uid} LIMIT 1`))[0] ?? null;

/** The oldest user with this email, ignoring case. */
export const oldestUserByEmailIgnoreCase = async (db: Db, email: string): Promise<Row | null> =>
  (await rowsOf(db, sql`SELECT ${USER_COLUMNS}
    FROM public."user" WHERE upper(email) = upper(${email}) ORDER BY created_at ASC LIMIT 1`))[0] ?? null;

/** Every column set (preferred_language, google_sub, avatar_url, theme NULL; the digest on). */
export async function insertImportedUser(db: Db, user: Row, now: string): Promise<void> {
  await db.execute(sql`
        INSERT INTO public."user" (id, email, file_number, career_id, plan, name, created_at, updated_at, preferred_language, google_sub,
                                   avatar_url, theme, linkedin, instagram, discord, firebase_uid, digest_email_enabled)
        VALUES (${user.id}, ${user.email}, NULL, ${user.career_id}, ${user.plan}, ${user.name}, ${now}, ${now}, NULL, NULL,
                NULL, NULL, ${user.linkedin}, ${user.instagram}, ${user.discord}, ${user.firebase_uid}, true)`);
}

export async function updateImportedUser(db: Db, user: Row, now: string): Promise<void> {
  await db.execute(sql`
        UPDATE public."user" SET firebase_uid = ${user.firebase_uid}, name = ${user.name}, career_id = ${user.career_id}, plan = ${user.plan},
          linkedin = ${user.linkedin}, instagram = ${user.instagram}, discord = ${user.discord}, updated_at = ${now}
        WHERE id = ${user.id}`);
}

/** The user's moderator grants (revoked_at). */
export const moderatorGrantsOf = (db: Db, userId: string): Promise<Row[]> =>
  rowsOf(db, sql`SELECT revoked_at FROM public.ceitba_moderators WHERE user_id = ${userId}`);

export async function insertModeratorGrant(db: Db, userId: string, grantedAt: string): Promise<void> {
  await db.execute(sql`INSERT INTO public.ceitba_moderators (user_id, granted_by, granted_at, revoked_at, revoked_by)
          VALUES (${userId}, NULL, ${grantedAt}, NULL, NULL)`);
}

// ---- benefits (Firestore benefits/) -------------------------------------------------------

/** A text[] literal bound as one parameter. */
function textArray(values: string[]) {
  return sql`${`{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`}::text[]`;
}

/** The cards whose Spanish title equals `title`, ignoring case. */
export const benefitCardsTitled = (db: Db, title: string): Promise<Row[]> =>
  rowsOf(db, sql`SELECT id, category_slug, title_es, bullets_es, image_url, cta_url, location, location_url, phone, website, email
      FROM public.benefit_cards WHERE upper(title_es) = upper(${title})`);

export async function insertBenefitCard(db: Db, card: Row, titleEn: string, bullets: string[], now: string): Promise<void> {
  await db.execute(sql`
        INSERT INTO public.benefit_cards (id, category_slug, display_order, title_es, title_en, summary_es, summary_en, image_url, cta_url,
          cta_label_es, cta_label_en, price, bullets_es, bullets_en, created_at, updated_at, location, location_url, phone, website, email)
        VALUES (${card.id}, ${card.category_slug}, 0, ${card.title_es}, ${titleEn}, '', '', ${card.image_url}, ${card.cta_url},
          NULL, NULL, NULL, ${textArray(bullets)}, '{}'::text[], ${now}, ${now}, ${card.location}, ${card.location_url}, ${card.phone}, ${card.website}, ${card.email})`);
}

export async function updateBenefitCard(db: Db, card: Row, bullets: string[], now: string): Promise<void> {
  await db.execute(sql`
        UPDATE public.benefit_cards SET category_slug = ${card.category_slug}, title_es = ${card.title_es}, bullets_es = ${textArray(bullets)},
          image_url = ${card.image_url}, cta_url = ${card.cta_url}, location = ${card.location}, location_url = ${card.location_url},
          phone = ${card.phone}, website = ${card.website}, email = ${card.email}, updated_at = ${now}
        WHERE id = ${card.id}`);
}

export const benefitCategoryExists = async (db: Db, slug: string): Promise<boolean> =>
  (await rowsOf(db, sql`SELECT 1 FROM public.benefits WHERE slug = ${slug}`)).length > 0;

// ---- academic catalogue -------------------------------------------------------------------

/** careerRepository.findAll(): no ORDER BY (id, name). */
export const careerNames = (db: Db): Promise<Row[]> => rowsOf(db, sql`SELECT id, name FROM public.careers`);

/** planRepository.findAll(): no ORDER BY (id, career_id). */
export const planCareers = (db: Db): Promise<Row[]> => rowsOf(db, sql`SELECT id, career_id FROM public.plan`);

/** careerRepository.findAll() ids: no ORDER BY. */
export const careerIds = async (db: Db): Promise<string[]> => (await rowsOf(db, sql`SELECT id FROM public.careers`)).map((r) => r.id as string);

/** planRepository.findByCareer_Id ids: no ORDER BY. */
export const planIdsOfCareer = async (db: Db, careerId: string): Promise<string[]> =>
  (await rowsOf(db, sql`SELECT id FROM public.plan WHERE career_id = ${careerId}`)).map((r) => r.id as string);

// ---- proposals (Firestore propuestas/) ----------------------------------------------------

const count = (r: unknown) => (r as { count?: number }).count ?? 0;

export function dbImportRows(db: Db): ProposalImportRows {
  return {
    async insertProposal(id, authorId, title, description, topic, status, lifecycle, reason, mod, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`
        INSERT INTO public.proposal (id, author_id, title, description, topic, status, lifecycle, rejection_reason, moderated_by, created_at, updated_at)
        VALUES (${id}, ${authorId}, ${title}, ${description}, ${topic}, ${status}, ${lifecycle}, ${reason}, ${mod}, ${ts}, ${ts})
        ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async proposalExists(id) {
      const rows = (await db.execute(sql`SELECT EXISTS (SELECT 1 FROM public.proposal WHERE id = ${id}) AS e`)) as unknown as { e: boolean }[];
      return rows[0]!.e === true;
    },
    async lockProposal(id) {
      await db.execute(sql`SELECT id FROM public.proposal WHERE id = ${id} FOR UPDATE`);
    },
    async aliases(proposalId) {
      const rows = (await db.execute(sql`SELECT user_id, alias FROM public.proposal_alias WHERE proposal_id = ${proposalId}`)) as unknown as { user_id: string; alias: string }[];
      return new Map(rows.map((r) => [r.user_id, r.alias]));
    },
    async insertAlias(proposalId, userId, alias) {
      return count(await db.execute(sql`INSERT INTO public.proposal_alias (proposal_id, user_id, alias) VALUES (${proposalId}, ${userId}, ${alias}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async insertVote(proposalId, userId, value, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`INSERT INTO public.proposal_vote (proposal_id, user_id, value, created_at, updated_at)
        VALUES (${proposalId}, ${userId}, ${value}, ${ts}, ${ts}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async insertComment(id, proposalId, authorId, parentId, body, at) {
      return count(await db.execute(sql`INSERT INTO public.proposal_comment (id, proposal_id, author_id, parent_id, body, created_at)
        VALUES (${id}, ${proposalId}, ${authorId}, ${parentId}, ${body}, ${toPgTimestamp(at)}) ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async insertDeletedComment(id, proposalId, parentId, at) {
      const ts = toPgTimestamp(at);
      return count(await db.execute(sql`INSERT INTO public.proposal_comment (id, proposal_id, parent_id, body, created_at, deleted_at)
        VALUES (${id}, ${proposalId}, ${parentId}, NULL, ${ts}, ${ts}) ON CONFLICT (id) DO NOTHING`)) === 1;
    },
    async insertAttachment(proposalId, position, key, type) {
      return count(await db.execute(sql`INSERT INTO public.proposal_attachment (proposal_id, position, object_key, content_type)
        VALUES (${proposalId}, ${position}, ${key}, ${type}) ON CONFLICT DO NOTHING`)) === 1;
    },
    async recomputeCounters(id) {
      await db.execute(sql`
        UPDATE public.proposal p SET
            up_count      = (SELECT count(*) FROM public.proposal_vote v WHERE v.proposal_id = p.id AND v.value = 'UP'),
            down_count    = (SELECT count(*) FROM public.proposal_vote v WHERE v.proposal_id = p.id AND v.value = 'DOWN'),
            comment_count = (SELECT count(*) FROM public.proposal_comment c WHERE c.proposal_id = p.id AND c.deleted_at IS NULL)
        WHERE p.id = ${id}`);
    },
  };
}

export function dbImportUsers(db: Db): ImportUsers {
  return {
    async findByFirebaseUidIn(uids) {
      if (uids.length === 0) return new Map();
      const rows = (await db.execute(sql`SELECT id, firebase_uid FROM public."user" WHERE firebase_uid IN (${sql.join(uids.map((u) => sql`${u}`), sql`, `)})`)) as unknown as { id: string; firebase_uid: string }[];
      return new Map(rows.map((r) => [r.firebase_uid, r.id]));
    },
    async isDeletedFirebaseAccount(uid) {
      const rows = (await db.execute(sql`SELECT EXISTS (SELECT 1 FROM public.deleted_firebase_accounts
        WHERE firebase_uid_sha256 = encode(sha256(convert_to(${uid}, 'UTF8')), 'hex')) AS e`)) as unknown as { e: boolean }[];
      return rows[0]!.e === true;
    },
  };
}

