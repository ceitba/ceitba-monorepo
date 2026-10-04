package org.ceitba.api.repository.digest;

import org.ceitba.api.domain.digest.DigestDelivery;
import org.ceitba.api.domain.digest.DigestDeliveryId;
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

    // Claims the next recipient to send to; run inside the claiming
    // transaction, which then calls markSending and commits BEFORE the SMTP
    // call. SKIP LOCKED: two workers never get the same row. Fresh rows first
    // (attempts, then user id), so a recipient that keeps failing with a
    // temporary error goes behind the others; a retried row waits until
    // `retryBefore` has passed since its last attempt.
    @Query(value = """
        SELECT * FROM public.digest_deliveries
        WHERE issue_id = :issueId AND status = 'pending'
          AND (claimed_at IS NULL OR claimed_at <= :retryBefore)
        ORDER BY attempts ASC, user_id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        """, nativeQuery = true)
    Optional<DigestDelivery> lockNextPending(@Param("issueId") UUID issueId,
                                             @Param("retryBefore") OffsetDateTime retryBefore);

    // Send attempts (sent or failed) since `since`, across issues: the rolling
    // daily quota (digest.daily-limit).
    @Query("SELECT COUNT(d) FROM DigestDelivery d WHERE d.sentAt IS NOT NULL AND d.sentAt > :since")
    long countAttemptsSince(@Param("since") OffsetDateTime since);

    // pending -> sending: the claim, committed before the SMTP call. The
    // outcome of a row left `sending` (crash) is unknown: failStale.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'sending', d.claimedAt = :now
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'pending'
        """)
    int markSending(@Param("issueId") UUID issueId, @Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    // sending -> sent. Callers check the count: 0 means the row was changed
    // meanwhile (e.g. reclaimed as stale).
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'sent', d.sentAt = :now, d.error = NULL
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'sending'
        """)
    int markSent(@Param("issueId") UUID issueId, @Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    // sending -> failed (final).
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'failed', d.sentAt = :now, d.error = :error
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'sending'
        """)
    int markFailed(@Param("issueId") UUID issueId, @Param("userId") UUID userId,
                   @Param("now") OffsetDateTime now, @Param("error") String error);

    // sending -> pending after a TRANSIENT failure: one more attempt counted;
    // claimed_at stays, so the row waits before it is tried again.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'pending', d.attempts = d.attempts + 1, d.lastError = :error
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'sending'
        """)
    int retryLater(@Param("issueId") UUID issueId, @Param("userId") UUID userId, @Param("error") String error);

    // sending -> pending when nothing was attempted (transport down, issue
    // cancelled before the send): no attempt counted, tried first next run.
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'pending', d.claimedAt = NULL, d.lastError = :error
        WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'sending'
        """)
    int release(@Param("issueId") UUID issueId, @Param("userId") UUID userId, @Param("error") String error);

    // Rows claimed before `cutoff` and never resolved: the process died around
    // the SMTP call, so whether the email left is unknown. They are marked
    // failed and NEVER resent (delivery is at-most-once).
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestDelivery d SET d.status = 'failed', d.sentAt = d.claimedAt, d.error = :error
        WHERE d.status = 'sending' AND d.claimedAt < :cutoff
        """)
    int failStale(@Param("cutoff") OffsetDateTime cutoff, @Param("error") String error);

    // A claimed recipient that no longer qualifies (unsubscribed, deleted
    // follows, left the allowed domains) or whose issue was cancelled before
    // the send: dropped instead of sent.
    @Modifying
    @Transactional
    @Query("DELETE FROM DigestDelivery d WHERE d.issueId = :issueId AND d.userId = :userId AND d.status = 'sending'")
    int deleteClaimed(@Param("issueId") UUID issueId, @Param("userId") UUID userId);

    // Stopping a sending issue (DigestService.cancel): what was not sent yet
    // is dropped, so counts keep only sent/failed.
    @Modifying
    @Transactional
    @Query("DELETE FROM DigestDelivery d WHERE d.issueId = :issueId AND d.status = 'pending'")
    int deleteAllPending(@Param("issueId") UUID issueId);
}
