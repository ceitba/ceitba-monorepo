// repository/AccountDeletionRepository: the bulk, cross-schema statements
// behind DELETE /v1/me, verbatim. Native SQL on purpose: several FKs are ON
// DELETE RESTRICT, so rows go explicitly and in dependency order. Callers own
// the transaction.

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';

const exec = (db: Db, q: SQL) => db.execute(q);

// --- Personal data: always deleted -----------------------------------

export async function deleteSessionsAndCredentials(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.refresh_tokens WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.api_keys WHERE user_id = ${u}`);
  // Push targets: an anonymized tombstone must not keep receiving pushes.
  await exec(db, sql`DELETE FROM public.user_devices WHERE user_id = ${u}`);
}

export async function deleteStaffMembership(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.ceitba_staff WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.ceitba_moderators WHERE user_id = ${u}`);
}

export async function deleteSocialData(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.user_follows WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.user_organizations WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.event_rsvps WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.org_mail_optouts WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.org_announcement_deliveries WHERE user_id = ${u}`);
}

export async function deleteSchedulesAndShares(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.share_session_participants WHERE user_id = ${u}`);
  // Cascades to the other participants of sessions this user created.
  await exec(db, sql`DELETE FROM public.share_sessions WHERE creator_user_id = ${u}`);
  await exec(db, sql`DELETE FROM public.saved_schedules WHERE user_id = ${u}`);
}

// A group the user owns passes to its earliest remaining joiner (ties by user
// id) and is deleted only when the user was its only member.
export async function deleteStudyGroups(db: Db, u: string): Promise<void> {
  await exec(db, sql`
    UPDATE public.study_groups g
    SET owner_id = (SELECT p.user_id FROM public.study_group_participants p
                    WHERE p.group_id = g.id AND p.user_id <> ${u}
                    ORDER BY p.joined_at, p.user_id LIMIT 1),
        updated_at = now()
    WHERE g.owner_id = ${u}
      AND EXISTS (SELECT 1 FROM public.study_group_participants p
                  WHERE p.group_id = g.id AND p.user_id <> ${u})`);
  await exec(db, sql`DELETE FROM public.study_groups WHERE owner_id = ${u}`);
  await exec(db, sql`DELETE FROM public.study_group_participants WHERE user_id = ${u}`);
}

export async function deleteWikiPersonalData(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM wiki.subject_difficulty WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM wiki.subject_comment_vote WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM wiki.subject_note_vote WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM wiki.career_note_vote WHERE user_id = ${u}`);
  // Comments are free text written by the user: removed with everyone's votes on them.
  await exec(db, sql`DELETE FROM wiki.subject_comment_vote WHERE comment_id IN (SELECT id FROM wiki.subject_comment WHERE user_id = ${u})`);
  await exec(db, sql`DELETE FROM wiki.subject_comment WHERE user_id = ${u}`);
  // Unreviewed proposals have no value to anyone else.
  await exec(db, sql`DELETE FROM wiki.subject_wiki_edit_proposal WHERE proposed_by = ${u} AND status = 'PENDING'`);
  // Both bookmark tables exist on fresh databases; guard each in case one is absent on an old DB.
  if (await tableExists(db, 'wiki."Subject_Bookmarks"')) await exec(db, sql`DELETE FROM wiki."Subject_Bookmarks" WHERE user_id = ${u}`);
  if (await tableExists(db, 'wiki.subject_bookmarks')) await exec(db, sql`DELETE FROM wiki.subject_bookmarks WHERE user_id = ${u}`);
}

// --- Shared content: kept, authorship detached ------------------------

export async function detachNewsletterAuthorship(db: Db, u: string): Promise<void> {
  await exec(db, sql`UPDATE public.articles SET created_by = NULL WHERE created_by = ${u}`);
  await exec(db, sql`UPDATE public.news_events SET created_by = NULL WHERE created_by = ${u}`);
}

// Proposals board: counters fixed before the rows they count go away.
export async function deleteProposalData(db: Db, u: string): Promise<void> {
  await exec(db, sql`
    UPDATE public.proposal p
    SET up_count = p.up_count - v.ups, down_count = p.down_count - v.downs
    FROM (SELECT proposal_id,
                 count(*) FILTER (WHERE value = 'UP')   AS ups,
                 count(*) FILTER (WHERE value = 'DOWN') AS downs
          FROM public.proposal_vote WHERE user_id = ${u} GROUP BY proposal_id) v
    WHERE p.id = v.proposal_id`);
  await exec(db, sql`DELETE FROM public.proposal_vote WHERE user_id = ${u}`);
  await exec(db, sql`
    UPDATE public.proposal p
    SET comment_count = p.comment_count - c.n
    FROM (SELECT proposal_id, count(*) AS n FROM public.proposal_comment
          WHERE author_id = ${u} AND deleted_at IS NULL GROUP BY proposal_id) c
    WHERE p.id = c.proposal_id`);
  await exec(db, sql`
    UPDATE public.proposal_comment
    SET body = NULL, author_id = NULL, deleted_at = COALESCE(deleted_at, now())
    WHERE author_id = ${u}`);
  // Cascades to their attachments, votes, comments and aliases.
  await exec(db, sql`DELETE FROM public.proposal WHERE author_id = ${u} AND status <> 'APPROVED'`);
  await exec(db, sql`UPDATE public.proposal SET author_id = NULL WHERE author_id = ${u}`);
  await exec(db, sql`DELETE FROM public.proposal_alias WHERE user_id = ${u}`);
}

export async function detachScheduleCorrections(db: Db, u: string): Promise<void> {
  await exec(db, sql`UPDATE public.schedule_correction SET suggester_id = NULL WHERE suggester_id = ${u}`);
  await exec(db, sql`UPDATE public.schedule_correction SET reviewed_by = NULL WHERE reviewed_by = ${u}`);
}

export async function deleteDriveSources(db: Db, u: string): Promise<void> {
  await exec(db, sql`UPDATE wiki.drive_source SET reviewed_by = NULL WHERE reviewed_by = ${u}`);
  await exec(db, sql`DELETE FROM wiki.drive_file_report WHERE user_id = ${u}`);
  await exec(db, sql`DELETE FROM wiki.drive_source WHERE user_id = ${u}`);
}

// Keyed by the user's email: otherwise they would apply again to a new account with that email.
export async function deleteCapabilityGrants(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.capability_user_grants WHERE email = (SELECT lower(u.email) FROM public."user" u WHERE u.id = ${u})`);
}

export async function deleteOrgInvites(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public.org_invites WHERE email = (SELECT lower(u.email) FROM public."user" u WHERE u.id = ${u})`);
}

export async function deleteKbReports(db: Db, u: string): Promise<void> {
  await exec(db, sql`
    UPDATE wiki.kb_page p SET report_count = greatest(p.report_count - 1, 0)
    WHERE p.id IN (SELECT r.page_id FROM wiki.kb_page_report r WHERE r.user_id = ${u})`);
  await exec(db, sql`DELETE FROM wiki.kb_page_report WHERE user_id = ${u}`);
}

/** Wiki contributions other students rely on whose author FK is NOT NULL. */
export async function countRetainedContributions(db: Db, u: string): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT (SELECT count(*) FROM wiki.subject_note WHERE uploader_id = ${u})
         + (SELECT count(*) FROM wiki.career_note  WHERE uploader_id = ${u})
         + (SELECT count(*) FROM wiki.subject_wiki_page WHERE updated_by = ${u})
         + (SELECT count(*) FROM wiki.subject_wiki_edit_proposal WHERE proposed_by = ${u}) AS n`);
  return Number(r?.n ?? 0);
}

// --- Tombstones / the user row -----------------------------------------

export async function recordDeletedFirebaseAccount(db: Db, u: string): Promise<void> {
  await exec(db, sql`
    INSERT INTO public.deleted_firebase_accounts (firebase_uid_sha256)
    SELECT encode(sha256(convert_to(firebase_uid, 'UTF8')), 'hex')
    FROM public."user"
    WHERE id = ${u} AND firebase_uid IS NOT NULL
    ON CONFLICT DO NOTHING`);
}

export async function deleteUser(db: Db, u: string): Promise<void> {
  await exec(db, sql`DELETE FROM public."user" WHERE id = ${u}`);
}

/** Every personal column cleared; the email becomes a non-routable placeholder. */
export async function anonymizeUser(db: Db, u: string): Promise<void> {
  await exec(db, sql`
    UPDATE public."user"
    SET email = ${`deleted-${u}@deleted.invalid`}, name = NULL, google_sub = NULL, firebase_uid = NULL, avatar_url = NULL,
        file_number = NULL, career_id = NULL, plan = NULL,
        linkedin = NULL, instagram = NULL, discord = NULL,
        theme = NULL, preferred_language = NULL,
        updated_at = now()
    WHERE id = ${u}`);
}

async function tableExists(db: Db, qualifiedName: string): Promise<boolean> {
  const [r] = await db.execute<{ e: boolean }>(sql`SELECT to_regclass(${qualifiedName}) IS NOT NULL AS e`);
  return r?.e === true;
}

// --- What the cross-feature steps need to know (see accountDeletion.ts) ----

export async function hasScheduleCorrectionVotes(db: Db, u: string): Promise<boolean> {
  const [r] = await db.execute<{ e: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM public.schedule_correction_vote WHERE user_id = ${u}) AS e`);
  return r?.e === true;
}

export async function hasDriveData(db: Db, u: string): Promise<boolean> {
  const [r] = await db.execute<{ e: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM wiki.drive_source WHERE user_id = ${u})
    OR EXISTS (SELECT 1 FROM wiki.drive_file_report WHERE user_id = ${u}) AS e`);
  return r?.e === true;
}

/** The orgs where the user is an admin (OrganizationMembershipService.requireNotLastAdmin). */
export async function adminOrgsOf(db: Db, u: string): Promise<string[]> {
  const rows = await db.execute<{ org_slug: string }>(sql`SELECT org_slug FROM public.user_organizations WHERE user_id = ${u} AND role = 'admin'`);
  return [...rows].map((r) => r.org_slug);
}
