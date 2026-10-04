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

    // Send attempts (sent or failed) since `since`, across issues: the rolling
    // daily quota (digest.daily-limit).
    @Query("SELECT COUNT(d) FROM DigestDelivery d WHERE d.sentAt IS NOT NULL AND d.sentAt > :since")
    long countAttemptsSince(@Param("since") OffsetDateTime since);

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
