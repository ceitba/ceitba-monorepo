package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.ceitba.api.service.mail.EmailSendException.Kind.RECIPIENT;
import static org.ceitba.api.service.mail.EmailSendException.Kind.TRANSIENT;
import static org.ceitba.api.service.mail.EmailSendException.Kind.TRANSPORT;

// Who an SMTP reply blames decides whether one bad recipient fails alone
// (RECIPIENT), is retried a few times (TRANSIENT) or pauses the whole batch
// (TRANSPORT).
class SmtpReplyClassificationTest {

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "452 4.2.2 The email account that you tried to reach is over quota|RECIPIENT",
        "550 5.1.1 The email account that you tried to reach does not exist|RECIPIENT",
        "552 5.2.2 Mailbox size limit exceeded|RECIPIENT",
        "451 4.1.1 bad destination mailbox|RECIPIENT",
        "550 5.4.5 Daily user sending limit exceeded|TRANSPORT",
        "421 4.7.0 Try again later, closing connection|TRANSPORT",
        "454 4.7.0 Too many login attempts, please try again later|TRANSPORT",
        "535 5.7.8 Username and Password not accepted|TRANSPORT",
        "451 4.3.0 Mail system temporarily unavailable|TRANSIENT",
        "452 4.5.3 Too many recipients|TRANSIENT",
    })
    void classifiesTheReplyByItsEnhancedStatusCode(String reply, EmailSendException.Kind expected) {
        assertThat(SmtpEmailSender.classifyReply(reply)).isEqualTo(expected);
    }

    @Test
    void replyWithoutCodeFallsBackToTheWording() {
        assertThat(SmtpEmailSender.classifyReply("Daily limit exceeded")).isEqualTo(TRANSPORT);
        assertThat(SmtpEmailSender.classifyReply("connection reset")).isNull();
        // A permanent reply that blames nobody in particular is left to the caller.
        assertThat(SmtpEmailSender.classifyReply("550 5.7.1 message rejected")).isNull();
    }

    @Test
    void wrapsByExceptionTypeAndUnknownErrorsAreTheTransports() {
        assertThat(SmtpEmailSender.classify(new MailAuthenticationException("bad")).kind()).isEqualTo(TRANSPORT);
        assertThat(SmtpEmailSender.classify(new MailSendException("Mail server connection failed")).kind())
            .isEqualTo(TRANSPORT);
        assertThat(SmtpEmailSender.classify(new MailSendException("550 5.1.1 no such user")).kind())
            .isEqualTo(RECIPIENT);
    }
}
