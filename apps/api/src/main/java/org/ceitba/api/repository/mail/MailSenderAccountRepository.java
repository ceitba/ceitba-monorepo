package org.ceitba.api.repository.mail;

import org.ceitba.api.domain.mail.MailSenderAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

public interface MailSenderAccountRepository extends JpaRepository<MailSenderAccount, Long> {

    Optional<MailSenderAccount> findFirstByOwnerTypeAndOwnerRefIsNull(String ownerType);

    Optional<MailSenderAccount> findFirstByOwnerTypeAndOwnerRef(String ownerType, String ownerRef);

    @Query("SELECT a FROM MailSenderAccount a WHERE lower(a.email) = lower(:email)")
    Optional<MailSenderAccount> findByEmailIgnoreCase(@Param("email") String email);

    List<MailSenderAccount> findAllByOrderByIdAsc();

    // Single-statement updates: the send path must not read-modify-write the
    // row (it would clobber a concurrent reconnect).
    @Modifying
    @Transactional
    @Query("UPDATE MailSenderAccount a SET a.status = 'broken', a.lastError = :error "
        + "WHERE a.id = :id AND a.refreshTokenEnc = :tokenEnc")
    int markBroken(@Param("id") Long id, @Param("tokenEnc") String tokenEnc, @Param("error") String error);

    @Modifying
    @Transactional
    @Query("UPDATE MailSenderAccount a SET a.lastUsedAt = :at WHERE a.id = :id")
    int markUsed(@Param("id") Long id, @Param("at") OffsetDateTime at);
}
