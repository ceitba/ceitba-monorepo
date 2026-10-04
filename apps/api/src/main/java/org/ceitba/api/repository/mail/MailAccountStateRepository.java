package org.ceitba.api.repository.mail;

import org.ceitba.api.domain.mail.MailAccountState;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MailAccountStateRepository extends JpaRepository<MailAccountState, String> {
}
