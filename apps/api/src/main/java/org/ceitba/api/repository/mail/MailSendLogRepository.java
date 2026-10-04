package org.ceitba.api.repository.mail;

import org.ceitba.api.domain.mail.MailSendLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

public interface MailSendLogRepository extends JpaRepository<MailSendLog, Long> {

    // Recipients of the attempts that reached the provider ('sent' and
    // 'rejected') after `since`: what the rolling quota counts.
    @Query("""
        SELECT COALESCE(SUM(l.recipients), 0) FROM MailSendLog l
        WHERE l.account = :account AND l.attemptedAt > :since AND l.outcome IN ('sent', 'rejected')
        """)
    Number sumCountedSince(@Param("account") String account, @Param("since") OffsetDateTime since);

    // Retention (MailRetentionService).
    @Modifying
    @Transactional
    @Query("DELETE FROM MailSendLog l WHERE l.attemptedAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") OffsetDateTime cutoff);

    @Query("""
        SELECT l FROM MailSendLog l
        WHERE l.account = :account AND l.attemptedAt > :since AND l.outcome IN ('sent', 'rejected')
        ORDER BY l.attemptedAt ASC, l.id ASC
        """)
    List<MailSendLog> findCountedSince(@Param("account") String account, @Param("since") OffsetDateTime since);
}
