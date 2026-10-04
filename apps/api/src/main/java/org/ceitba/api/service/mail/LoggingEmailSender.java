package org.ceitba.api.service.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// MAIL_ENABLED=false (the default): nothing leaves the process, so dev and
// tests never email real people. Logs who would have received what.
public class LoggingEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingEmailSender.class);

    @Override
    public void send(OutgoingEmail email) {
        log.info("Mail disabled (MAIL_ENABLED=false); not sending \"{}\" to {}", email.subject(), email.to());
    }
}
