package org.ceitba.api.repository.orgmail;

import org.ceitba.api.domain.orgmail.OrgAnnouncement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

public interface OrgAnnouncementRepository extends JpaRepository<OrgAnnouncement, Long> {

    List<OrgAnnouncement> findTop50ByOrgSlugOrderByCreatedAtDesc(String orgSlug);

    Optional<OrgAnnouncement> findByIdAndOrgSlug(Long id, String orgSlug);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM OrgAnnouncement a WHERE a.id = :id AND a.orgSlug = :org")
    Optional<OrgAnnouncement> findForUpdate(@Param("id") Long id, @Param("org") String org);

    @Query("SELECT a.id FROM OrgAnnouncement a WHERE a.status = 'sending' ORDER BY a.sentAt, a.id")
    List<Long> findSendingIds();

    // Sent (or sending) since `since`: the weekly cap.
    @Query("SELECT count(a) FROM OrgAnnouncement a WHERE a.orgSlug = :org AND a.status <> 'draft' AND a.sentAt >= :since")
    long countSentSince(@Param("org") String org, @Param("since") OffsetDateTime since);

    // [announcements, recipients] the org sent since `since` (stats).
    @Query(value = """
        SELECT count(*), coalesce(sum(recipient_count), 0) FROM public.org_announcements
        WHERE org_slug = :org AND status <> 'draft' AND sent_at >= :since
        """, nativeQuery = true)
    List<Object[]> totalsSince(@Param("org") String org, @Param("since") OffsetDateTime since);

    // sending -> sent once no delivery is pending or in flight.
    @Modifying
    @Transactional
    @Query(value = """
        UPDATE public.org_announcements a SET status = 'sent', finished_at = :now
        WHERE a.id = :id AND a.status = 'sending'
          AND NOT EXISTS (SELECT 1 FROM public.org_announcement_deliveries d
                          WHERE d.announcement_id = a.id AND d.status IN ('pending', 'sending'))
        """, nativeQuery = true)
    int markSentIfDone(@Param("id") Long id, @Param("now") OffsetDateTime now);

    // [user id, email] of the org's followers who haven't opted out of its emails.
    @Query(value = """
        SELECT u.id, u.email FROM public."user" u
        JOIN public.user_follows f ON f.user_id = u.id AND f.org_slug = :org
        WHERE NOT EXISTS (SELECT 1 FROM public.org_mail_optouts o WHERE o.user_id = u.id AND o.org_slug = :org)
        ORDER BY u.id
        """, nativeQuery = true)
    List<Object[]> findRecipients(@Param("org") String org);

    // Still follows the org and hasn't opted out (re-checked at send time).
    @Query(value = """
        SELECT EXISTS (SELECT 1 FROM public.user_follows f WHERE f.user_id = :userId AND f.org_slug = :org)
           AND NOT EXISTS (SELECT 1 FROM public.org_mail_optouts o WHERE o.user_id = :userId AND o.org_slug = :org)
        """, nativeQuery = true)
    boolean isStillRecipient(@Param("userId") java.util.UUID userId, @Param("org") String org);
}
