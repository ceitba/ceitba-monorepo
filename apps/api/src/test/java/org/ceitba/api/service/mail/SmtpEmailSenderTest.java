package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;

import static org.assertj.core.api.Assertions.assertThat;

class SmtpEmailSenderTest {

    @Test
    void gmailDailyLimitIsQuotaOtherTransportErrorsAreTransient() {
        assertThat(SmtpEmailSender.classify(new MailSendException(
            "550-5.4.5 Daily user sending limit exceeded. For more information on Gmail sending limits")).kind())
            .isEqualTo(EmailSendException.Kind.QUOTA);
        assertThat(SmtpEmailSender.classify(new MailSendException("421 4.7.0 Try again later")).kind())
            .isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(SmtpEmailSender.classify(new MailAuthenticationException("535 5.7.8 bad credentials")).kind())
            .isEqualTo(EmailSendException.Kind.TRANSIENT);
        assertThat(SmtpEmailSender.classify(new MailSendException("Connection refused")).kind())
            .isEqualTo(EmailSendException.Kind.TRANSIENT);
    }
}
