package org.ceitba.api.service.mail;

// MAIL_ENABLED=false (the default) without MAIL_LOG_SENDS: nothing can be
// sent, and nothing pretends to. Callers check enabled() first (digest send
// answers 409 MAIL_DISABLED); a send() that gets here anyway is a bug.
public class DisabledEmailSender implements EmailSender {

    @Override
    public void send(OutgoingEmail email) {
        throw new IllegalStateException("Mail is disabled (MAIL_ENABLED=false)");
    }

    @Override
    public boolean enabled() {
        return false;
    }
}
