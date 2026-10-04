package org.ceitba.api.repository.digest;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.digest.DigestIssue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DigestIssueRepository extends JpaRepository<DigestIssue, UUID> {

    List<DigestIssue> findAllByOrderByWeekStartDesc();

    boolean existsByWeekStart(LocalDate weekStart);

    // Row-locked load, so a staff edit/send/cancel and the auto-send job
    // serialize on the same issue.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM DigestIssue i WHERE i.id = :id")
    Optional<DigestIssue> findByIdForUpdate(@Param("id") UUID id);

    // Drafts whose auto-send time is in [notBefore, now].
    @Query("""
        SELECT i.id FROM DigestIssue i
        WHERE i.status = 'draft' AND i.autoSendAt IS NOT NULL
          AND i.autoSendAt <= :now AND i.autoSendAt >= :notBefore
        ORDER BY i.weekStart ASC
        """)
    List<UUID> findDueForAutoSend(@Param("now") OffsetDateTime now,
                                  @Param("notBefore") OffsetDateTime notBefore);

    @Query("SELECT i.id FROM DigestIssue i WHERE i.status = 'sending' ORDER BY i.weekStart ASC")
    List<UUID> findSendingIds();

    // sending -> sent once no delivery is pending or being sent. 0 rows = work
    // left (or not sending any more).
    @Modifying
    @Transactional
    @Query("""
        UPDATE DigestIssue i SET i.status = 'sent', i.sentAt = :now, i.updatedAt = :now
        WHERE i.id = :id AND i.status = 'sending'
          AND NOT EXISTS (SELECT 1 FROM DigestDelivery d WHERE d.issueId = :id AND d.status IN ('pending', 'sending'))
        """)
    int markSentIfDone(@Param("id") UUID id, @Param("now") OffsetDateTime now);

    // Status under a share lock, held by DigestSender for the duration of one
    // email: a concurrent cancel (findByIdForUpdate) waits for that email to
    // finish, and the sender never starts one after a cancel committed.
    @Query(value = "SELECT status FROM public.digest_issues WHERE id = :id FOR SHARE", nativeQuery = true)
    Optional<String> findStatusForShare(@Param("id") UUID id);
}
