package org.ceitba.api.repository.digest;

import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestDeliveryId;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DigestDeliveryRepository extends JpaRepository<DigestDelivery, DigestDeliveryId> {

    // [issueId, status, count] rows.
    @Query("""
        SELECT d.issueId, d.status, COUNT(d) FROM DigestDelivery d
        WHERE d.issueId IN :issueIds GROUP BY d.issueId, d.status
        """)
    List<Object[]> countByIssueAndStatus(@Param("issueIds") List<UUID> issueIds);

    // Pending recipients in a stable order (the send loop takes them one by one).
    @Query("""
        SELECT d FROM DigestDelivery d
        WHERE d.issueId = :issueId AND d.status = 'pending'
        ORDER BY d.userId ASC
        """)
    List<DigestDelivery> findPending(@Param("issueId") UUID issueId, Limit limit);

    // ---- open/click tracking (docs/WEEKLY-DIGEST.md)

    // Set right before sending (in the delivery's own transaction).
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.trackingId = :trackingId
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'pending'
        """)
    int setTrackingId(@Param("issueId") UUID issueId, @Param("userId") UUID userId,
                      @Param("trackingId") String trackingId);

    Optional<DigestDelivery> findByTrackingId(String trackingId);

    // An unflagged open.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.openCount = d.openCount + 1,
            d.firstOpenedAt = COALESCE(d.firstOpenedAt, :now), d.lastOpenedAt = :now
        WHERE d.trackingId = :trackingId
        """)
    int recordOpen(@Param("trackingId") String trackingId, @Param("now") OffsetDateTime now);

    // An unflagged click; a click implies an open.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.clickCount = d.clickCount + 1,
            d.firstClickedAt = COALESCE(d.firstClickedAt, :now),
            d.firstOpenedAt = COALESCE(d.firstOpenedAt, :now),
            d.lastOpenedAt = COALESCE(d.lastOpenedAt, :now),
            d.openCount = CASE WHEN d.openCount = 0 THEN 1 ELSE d.openCount END
        WHERE d.trackingId = :trackingId
        """)
    int recordClick(@Param("trackingId") String trackingId, @Param("now") OffsetDateTime now);

    // [issueId, delivered, opened, clicked] over sent deliveries.
    @Query("""
        SELECT d.issueId,
               SUM(CASE WHEN d.status = 'sent' THEN 1 ELSE 0 END),
               SUM(CASE WHEN d.status = 'sent' AND d.firstOpenedAt IS NOT NULL THEN 1 ELSE 0 END),
               SUM(CASE WHEN d.status = 'sent' AND d.firstClickedAt IS NOT NULL THEN 1 ELSE 0 END)
        FROM DigestDelivery d WHERE d.issueId IN :issueIds GROUP BY d.issueId
        """)
    List<Object[]> engagementByIssue(@Param("issueIds") List<UUID> issueIds);

    // First (unique) opens per hour: [epoch seconds of the hour, count].
    @Query(value = """
        SELECT CAST(EXTRACT(EPOCH FROM date_trunc('hour', d.first_opened_at)) AS BIGINT), COUNT(*)
        FROM public.digest_deliveries d
        WHERE d.issue_id = :issueId AND d.status = 'sent' AND d.first_opened_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """, nativeQuery = true)
    List<Object[]> firstOpensByHour(@Param("issueId") UUID issueId);

    // Each transition commits on its own, right after the attempt, so a
    // restart resumes with the rows still pending and never resends a sent one.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'sent', d.sentAt = :now, d.error = NULL
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'pending'
        """)
    int markSent(@Param("issueId") UUID issueId, @Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'failed', d.sentAt = :now, d.error = :error
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'pending'
        """)
    int markFailed(@Param("issueId") UUID issueId, @Param("userId") UUID userId,
                   @Param("now") OffsetDateTime now, @Param("error") String error);

    // A snapshotted recipient that no longer qualifies (unsubscribed, deleted
    // follows, nothing left for them): dropped instead of sent.
    @Modifying
    @Transactional
    @Query("DELETE FROM DigestDelivery d WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'pending'")
    int deletePending(@Param("issueId") UUID issueId, @Param("userId") UUID userId);

    // Stopping a sending issue (DigestService.cancel): what was not sent yet
    // is dropped, so counts keep only sent/failed.
    @Modifying
    @Transactional
    @Query("DELETE FROM DigestDelivery d WHERE d.issueId = :issueId AND d.status = 'pending'")
    int deleteAllPending(@Param("issueId") UUID issueId);
}
