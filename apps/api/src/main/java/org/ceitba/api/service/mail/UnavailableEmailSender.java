package org.ceitba.api.service.mail;

import java.util.Optional;

// A transport that can't send at all, with the reason (e.g. organizations'
// accounts with MAIL_TRANSPORT=smtp, whose credentials are CEITBA's).
public class UnavailableEmailSender implements EmailSender {

    private final String reason;

    public UnavailableEmailSender(String reason) {
        this.reason = reason;
    }

    @Override
    public void send(OutgoingEmail email) {
        throw new MailSenderNotConnectedException(reason);
    }

    @Override
    public Optional<String> unavailableReason() {
        return Optional.of(reason);
    }
}
