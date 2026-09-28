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
    }

    public void deleteStaffMembership(UUID userId) {
        exec("DELETE FROM public.ceitba_staff WHERE user_id = :u", userId);
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

    public void deleteUser(UUID userId) {
        exec("DELETE FROM public.\"user\" WHERE id = :u", userId);
    }

    // Tombstone: strips every personal column. The email becomes a
    // non-routable placeholder so the same Google account signing in again
    // gets a brand-new, unrelated User row.
    public void anonymizeUser(UUID userId) {
        em.createNativeQuery("""
                UPDATE public."user"
                SET email = :email, name = NULL, google_sub = NULL, avatar_url = NULL,
                    file_number = NULL, career_id = NULL, plan = NULL,
                    theme = NULL, preferred_language = NULL, updated_at = now()
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
