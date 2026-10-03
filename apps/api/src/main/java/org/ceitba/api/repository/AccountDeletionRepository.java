package org.ceitba.api.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.util.UUID;

// Bulk, cross-schema statements behind DELETE /v1/me (AccountDeletionService).
// Native SQL on purpose: most of these tables have no inverse mapping on User
// (MIGRATION.md §3) and several FKs are ON DELETE RESTRICT, so the rows must
// be removed explicitly and in dependency order. Callers own the transaction.
@Repository
public class AccountDeletionRepository {

    @PersistenceContext
    private EntityManager em;

    // --- Personal data: always deleted -----------------------------------

    public void deleteSessionsAndCredentials(UUID userId) {
        exec("DELETE FROM public.refresh_tokens WHERE user_id = :u", userId);
        exec("DELETE FROM public.api_keys WHERE user_id = :u", userId);
        // Push targets: an anonymized tombstone must not keep receiving pushes.
        exec("DELETE FROM public.user_devices WHERE user_id = :u", userId);
    }

    public void deleteStaffMembership(UUID userId) {
        exec("DELETE FROM public.ceitba_staff WHERE user_id = :u", userId);
        exec("DELETE FROM public.ceitba_moderators WHERE user_id = :u", userId);
    }

    public void deleteSocialData(UUID userId) {
        exec("DELETE FROM public.user_follows WHERE user_id = :u", userId);
        exec("DELETE FROM public.user_organizations WHERE user_id = :u", userId);
    }

    public void deleteSchedulesAndShares(UUID userId) {
        exec("DELETE FROM public.share_session_participants WHERE user_id = :u", userId);
        // Cascades to the other participants of sessions this user created.
        exec("DELETE FROM public.share_sessions WHERE creator_user_id = :u", userId);
        exec("DELETE FROM public.saved_schedules WHERE user_id = :u", userId);
    }

    // Same rule as an owner leaving (StudyGroupService.leave): a group the
    // user owns passes to its earliest remaining joiner (ties by user id) and
    // is deleted only when the user was its only member. Then every
    // membership of the user goes. Runs before the user row is deleted, so
    // the owner_id ON DELETE CASCADE never removes a group others are in.
    public void deleteStudyGroups(UUID userId) {
        exec("""
            UPDATE public.study_groups g
            SET owner_id = (SELECT p.user_id FROM public.study_group_participants p
                            WHERE p.group_id = g.id AND p.user_id <> :u
                            ORDER BY p.joined_at, p.user_id LIMIT 1),
                updated_at = now()
            WHERE g.owner_id = :u
              AND EXISTS (SELECT 1 FROM public.study_group_participants p
                          WHERE p.group_id = g.id AND p.user_id <> :u)
            """, userId);
        exec("DELETE FROM public.study_groups WHERE owner_id = :u", userId);
        exec("DELETE FROM public.study_group_participants WHERE user_id = :u", userId);
    }

    public void deleteWikiPersonalData(UUID userId) {
        exec("DELETE FROM wiki.subject_difficulty WHERE user_id = :u", userId);
        exec("DELETE FROM wiki.subject_comment_vote WHERE user_id = :u", userId);
        exec("DELETE FROM wiki.subject_note_vote WHERE user_id = :u", userId);
        exec("DELETE FROM wiki.career_note_vote WHERE user_id = :u", userId);
        // Comments are free text written by the user: removed with everyone's
        // votes on them (comment_id FK is RESTRICT).
        exec("""
            DELETE FROM wiki.subject_comment_vote
            WHERE comment_id IN (SELECT id FROM wiki.subject_comment WHERE user_id = :u)
            """, userId);
        exec("DELETE FROM wiki.subject_comment WHERE user_id = :u", userId);
        // Unreviewed proposals have no value to anyone else.
        exec("""
            DELETE FROM wiki.subject_wiki_edit_proposal
            WHERE proposed_by = :u AND status = 'PENDING'
            """, userId);
        // Both bookmark tables exist on fresh databases (V1 Prisma-cased and
        // V1.1 lowercase); guard each in case one is absent on an old DB.
        if (tableExists("wiki.\"Subject_Bookmarks\"")) {
            exec("DELETE FROM wiki.\"Subject_Bookmarks\" WHERE user_id = :u", userId);
        }
        if (tableExists("wiki.subject_bookmarks")) {
            exec("DELETE FROM wiki.subject_bookmarks WHERE user_id = :u", userId);
        }
    }

    // --- Shared content: kept, authorship detached ------------------------

    // Newsletter content belongs to the organization; created_by is nullable.
    public void detachNewsletterAuthorship(UUID userId) {
        exec("UPDATE public.articles SET created_by = NULL WHERE created_by = :u", userId);
        exec("UPDATE public.news_events SET created_by = NULL WHERE created_by = :u", userId);
    }

    // Proposals board. Counters are fixed before the rows they count go away.
    // Approved proposals stay (the author becomes NULL); everything else the
    // user wrote there is removed or tombstoned.
    public void deleteProposalData(UUID userId) {
        exec("""
            UPDATE public.proposal p
            SET up_count = p.up_count - v.ups, down_count = p.down_count - v.downs
            FROM (SELECT proposal_id,
                         count(*) FILTER (WHERE value = 'UP')   AS ups,
                         count(*) FILTER (WHERE value = 'DOWN') AS downs
                  FROM public.proposal_vote WHERE user_id = :u GROUP BY proposal_id) v
            WHERE p.id = v.proposal_id
            """, userId);
        exec("DELETE FROM public.proposal_vote WHERE user_id = :u", userId);
        exec("""
            UPDATE public.proposal p
            SET comment_count = p.comment_count - c.n
            FROM (SELECT proposal_id, count(*) AS n FROM public.proposal_comment
                  WHERE author_id = :u AND deleted_at IS NULL GROUP BY proposal_id) c
            WHERE p.id = c.proposal_id
            """, userId);
        exec("""
            UPDATE public.proposal_comment
            SET body = NULL, author_id = NULL, deleted_at = COALESCE(deleted_at, now())
            WHERE author_id = :u
            """, userId);
        // Cascades to their attachments, votes, comments and aliases.
        exec("DELETE FROM public.proposal WHERE author_id = :u AND status <> 'APPROVED'", userId);
        exec("UPDATE public.proposal SET author_id = NULL WHERE author_id = :u", userId);
        exec("DELETE FROM public.proposal_alias WHERE user_id = :u", userId);
    }

    // Schedule corrections are crowd data and stay: the user's suggestions and
    // staff reviews are detached here. Their votes are removed (and the
    // counters/statuses re-evaluated under the commission lock) by
    // ScheduleCorrectionService.withdrawVotesOf, which runs first.
    public void detachScheduleCorrections(UUID userId) {
        exec("UPDATE public.schedule_correction SET suggester_id = NULL WHERE suggester_id = :u", userId);
        exec("UPDATE public.schedule_correction SET reviewed_by = NULL WHERE reviewed_by = :u", userId);
    }

    // Drive sync (Apuntes): the user's registered folders and every copied
    // file (drive_file and the reports on them cascade). Their reports on
    // other students' files and the stored objects are handled first by
    // DriveModerationService.prepareAccountDeletion.
    public void deleteDriveSources(UUID userId) {
        exec("UPDATE wiki.drive_source SET reviewed_by = NULL WHERE reviewed_by = :u", userId);
        exec("DELETE FROM wiki.drive_file_report WHERE user_id = :u", userId);
        exec("DELETE FROM wiki.drive_source WHERE user_id = :u", userId);
    }

    // Subject-wiki reports by the user (page counters adjusted first).
    public void deleteKbReports(UUID userId) {
        exec("""
            UPDATE wiki.kb_page p SET report_count = greatest(p.report_count - 1, 0)
            WHERE p.id IN (SELECT r.page_id FROM wiki.kb_page_report r WHERE r.user_id = :u)
            """, userId);
        exec("DELETE FROM wiki.kb_page_report WHERE user_id = :u", userId);
    }

    // Wiki contributions other students rely on whose author FK is NOT NULL:
    // notes, career notes, wiki page revisions, reviewed edit proposals.
    public long countRetainedContributions(UUID userId) {
        var n = em.createNativeQuery("""
                SELECT (SELECT count(*) FROM wiki.subject_note WHERE uploader_id = :u)
                     + (SELECT count(*) FROM wiki.career_note  WHERE uploader_id = :u)
                     + (SELECT count(*) FROM wiki.subject_wiki_page WHERE updated_by = :u)
                     + (SELECT count(*) FROM wiki.subject_wiki_edit_proposal WHERE proposed_by = :u)
                """)
            .setParameter("u", userId)
            .getSingleResult();
        return ((Number) n).longValue();
    }

    // --- The user row ------------------------------------------------------

    // --- Tombstones ------------------------------------------------------

    // Remembers the account's Firebase uid (hashed) so a later Firestore
    // import does not re-create it. Must run before the user row is deleted
    // or anonymized (both clear firebase_uid). No-op for accounts that never
    // came from the legacy app.
    public void recordDeletedFirebaseAccount(UUID userId) {
        exec("""
            INSERT INTO public.deleted_firebase_accounts (firebase_uid_sha256)
            SELECT encode(sha256(convert_to(firebase_uid, 'UTF8')), 'hex')
            FROM public."user"
            WHERE id = :u AND firebase_uid IS NOT NULL
            ON CONFLICT DO NOTHING
            """, userId);
    }

    public void deleteUser(UUID userId) {
        exec("DELETE FROM public.\"user\" WHERE id = :u", userId);
    }

    // Tombstone: strips every personal column. The email becomes a
    // non-routable placeholder so the same Google account signing in again
    // gets a brand-new, unrelated User row.
    public void anonymizeUser(UUID userId) {
        em.createNativeQuery("""
                UPDATE public."user"
                SET email = :email, name = NULL, google_sub = NULL, firebase_uid = NULL, avatar_url = NULL,
                    file_number = NULL, career_id = NULL, plan = NULL,
                    linkedin = NULL, instagram = NULL, discord = NULL,
                    theme = NULL, preferred_language = NULL,
                    updated_at = now()
                WHERE id = :u
                """)
            .setParameter("email", "deleted-" + userId + "@deleted.invalid")
            .setParameter("u", userId)
            .executeUpdate();
    }

    private boolean tableExists(String qualifiedName) {
        return em.createNativeQuery("SELECT to_regclass(:t) IS NOT NULL")
            .setParameter("t", qualifiedName)
            .getSingleResult() instanceof Boolean b && b;
    }

    private void exec(String sql, UUID userId) {
        em.createNativeQuery(sql).setParameter("u", userId).executeUpdate();
    }
}
