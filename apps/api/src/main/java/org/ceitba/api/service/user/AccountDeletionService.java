package org.ceitba.api.service.user;

import org.ceitba.api.repository.AccountDeletionRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

// Self-service account deletion (DELETE /v1/me; App Store rule 5.1.1(v)).
// One transaction; the policy per table is:
//
//   deleted   refresh_tokens, api_keys (all sessions/credentials revoked),
//             user_devices (no more push notifications),
//             ceitba_staff, ceitba_moderators, user_follows, user_organizations,
//             saved_schedules, share_session_participants, share_sessions
//             created by the user (with their participants),
//             study_groups owned by the user (with their participants),
//             the user's study_group_participants rows,
//             wiki.subject_difficulty, all wiki votes cast by the user,
//             wiki.subject_comment (+ votes on those comments),
//             PENDING wiki.subject_wiki_edit_proposal, both bookmark tables.
//             proposal votes (counters adjusted), the user's proposals that
//             are not APPROVED, proposal aliases; proposal comments are
//             tombstoned (body cleared, author detached, counters adjusted)
//             so replies keep their parent.
//   detached  articles.created_by, news_events.created_by -> NULL
//             (content belongs to the organization); APPROVED
//             proposal.author_id -> NULL (the board keeps them, pseudonymous).
//   kept      wiki.subject_note, wiki.career_note, wiki.subject_wiki_page
//             revisions and reviewed edit proposals — shared study material
//             whose author FK is NOT NULL. If any exist, the user row is
//             anonymized (tombstone: every personal column cleared, email
//             replaced by deleted-<id>@deleted.invalid) instead of deleted.
//   user row  hard-deleted when nothing is kept; otherwise anonymized.
//             wiki.subject_wiki_edit_proposal.reviewed_by is ON DELETE SET NULL.
//   recorded  the SHA-256 of the account's legacy Firebase uid, if any, in
//             deleted_firebase_accounts, so the Firestore import never
//             re-creates the account (FirestoreImportService).
//
// The only active staff member cannot delete their account (409): the first
// STAFF row can only be bootstrapped with raw SQL (AUTH-AND-ROLES.md), so they
// must grant the role to someone else first. The check locks the active staff
// rows, so concurrent deletions by the last two staff members serialize.
//
// Already-issued access JWTs are stateless and stay valid until they expire:
// mobile access tokens after AUTH_MOBILE_ACCESS_TTL (15 min), but web cookies
// only after AUTH_JWT_TTL_DAYS (7 days). The DELETE response clears the cookie
// of the browser that made the call; a cookie on any other browser or device
// keeps working, and its first @CurrentUser request JIT-provisions the email
// again as a new, empty account (never linked back to the deleted data).
// Closing this needs server-side access-token revocation (a token_version or
// deletion tombstone checked at provisioning); see "Access-token revocation"
// in docs/AUTH-AND-ROLES.md.
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private final AccountDeletionRepository deletion;
    private final CeitbaStaffRepository staff;
    private final Clock clock;

    public AccountDeletionService(AccountDeletionRepository deletion, CeitbaStaffRepository staff, Clock clock) {
        this.deletion = deletion;
        this.staff    = staff;
        this.clock    = clock;
    }

    @Transactional
    public Outcome deleteAccount(UUID userId) {
        var now = OffsetDateTime.now(clock);
        if (staff.isActiveStaff(userId, now) && !otherActiveStaffRemains(userId, now)) {
            throw new LastActiveStaffException();
        }
        deletion.recordDeletedFirebaseAccount(userId);
        deletion.deleteSessionsAndCredentials(userId);
        deletion.deleteStaffMembership(userId);
        deletion.deleteSocialData(userId);
        deletion.deleteSchedulesAndShares(userId);
        deletion.deleteStudyGroups(userId);
        deletion.deleteWikiPersonalData(userId);
        deletion.detachNewsletterAuthorship(userId);
        deletion.deleteProposalData(userId);
        deletion.deleteScheduleCorrectionData(userId);

        if (deletion.countRetainedContributions(userId) > 0) {
            deletion.anonymizeUser(userId);
            log.info("Account {} anonymized (shared wiki contributions retained)", userId);
            return Outcome.ANONYMIZED;
        }
        deletion.deleteUser(userId);
        log.info("Account {} deleted", userId);
        return Outcome.DELETED;
    }

    // Locks every active staff row before looking, so two staff members
    // deleting their accounts at the same time cannot both see the other one
    // and leave no staff at all: the second call waits for the first to
    // commit and then no longer sees its (deleted) row.
    private boolean otherActiveStaffRemains(UUID userId, OffsetDateTime now) {
        return staff.findAllActiveForUpdate(now).stream()
            .anyMatch(s -> !s.getUserId().equals(userId));
    }

    public enum Outcome { DELETED, ANONYMIZED }
}
