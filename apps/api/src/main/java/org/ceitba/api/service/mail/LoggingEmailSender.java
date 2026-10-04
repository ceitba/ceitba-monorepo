package org.ceitba.api.service.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// DEV ONLY (MAIL_LOG_SENDS=true while MAIL_ENABLED=false): nothing leaves the
// process, the send is just logged as if it had succeeded. Recipient
// addresses are masked in the log.
public class LoggingEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingEmailSender.class);

    @Override
    public void send(OutgoingEmail email) {
        log.info("Mail log-only (MAIL_LOG_SENDS=true); not sending \"{}\" to {}", email.subject(), mask(email.to()));
    }

    // "alice@itba.edu.ar" -> "a***@itba.edu.ar"
    static String mask(String address) {
        if (address == null) return "(none)";
        int at = address.lastIndexOf('@');
        if (at <= 0) return "***";
        return address.charAt(0) + "***" + address.substring(at);
    }
}
