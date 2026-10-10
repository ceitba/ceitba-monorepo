package org.ceitba.api.repository.orgmail;

import org.ceitba.api.domain.orgmail.OrgAnnouncementDelivery;
import org.ceitba.api.domain.orgmail.OrgAnnouncementDeliveryId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

// Same lifecycle and queries as DigestDeliveryRepository (see its comments).
public interface OrgAnnouncementDeliveryRepository
        extends JpaRepository<OrgAnnouncementDelivery, OrgAnnouncementDeliveryId> {

    // [announcement id, status, count]
    @Query("""
        SELECT d.announcementId, d.status, count(d) FROM OrgAnnouncementDelivery d
        WHERE d.announcementId IN :ids GROUP BY d.announcementId, d.status
        """)
    List<Object[]> countByAnnouncementAndStatus(@Param("ids") Collection<Long> ids);

    @Query(value = """
        SELECT * FROM public.org_announcement_deliveries
        WHERE announcement_id = :id AND status = 'pending'
          AND (claimed_at IS NULL OR claimed_at <= :retryBefore)
        ORDER BY attempts ASC, user_id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        """, nativeQuery = true)
    Optional<OrgAnnouncementDelivery> lockNextPending(@Param("id") Long id,
                                                      @Param("retryBefore") OffsetDateTime retryBefore);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'sending', d.claimedAt = :now
        WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'pending'
        """)
    int markSending(@Param("id") Long id, @Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'sent', d.sentAt = :now, d.lastError = NULL
        WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'sending'
        """)
    int markSent(@Param("id") Long id, @Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'failed', d.sentAt = :now, d.lastError = :error
        WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'sending'
        """)
    int markFailed(@Param("id") Long id, @Param("userId") UUID userId,
                   @Param("now") OffsetDateTime now, @Param("error") String error);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'pending', d.attempts = d.attempts + 1, d.lastError = :error
        WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'sending'
        """)
    int retryLater(@Param("id") Long id, @Param("userId") UUID userId, @Param("error") String error);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'pending', d.claimedAt = NULL, d.lastError = :error
        WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'sending'
        """)
    int release(@Param("id") Long id, @Param("userId") UUID userId, @Param("error") String error);

    @Modifying
    @Transactional
    @Query("""
        UPDATE OrgAnnouncementDelivery d SET d.status = 'failed', d.sentAt = d.claimedAt, d.lastError = :error
        WHERE d.status = 'sending' AND d.claimedAt < :cutoff
        """)
    int failStale(@Param("cutoff") OffsetDateTime cutoff, @Param("error") String error);

    // A claimed recipient who unfollowed or opted out meanwhile: dropped.
    @Modifying
    @Transactional
    @Query("DELETE FROM OrgAnnouncementDelivery d WHERE d.announcementId = :id AND d.userId = :userId AND d.status = 'sending'")
    int deleteClaimed(@Param("id") Long id, @Param("userId") UUID userId);

    // Retention (MailRetentionService): rows of announcements finished before `cutoff`.
    @Modifying
    @Transactional
    @Query(value = """
        DELETE FROM public.org_announcement_deliveries d USING public.org_announcements a
        WHERE a.id = d.announcement_id AND a.status = 'sent' AND a.finished_at < :cutoff
        """, nativeQuery = true)
    int deleteFinishedBefore(@Param("cutoff") OffsetDateTime cutoff);
}
