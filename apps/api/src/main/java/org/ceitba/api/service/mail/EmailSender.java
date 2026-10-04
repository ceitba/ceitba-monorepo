package org.ceitba.api.service.mail;

// Transport-agnostic email sending (docs/WEEKLY-DIGEST.md). The SMTP
// implementation (SmtpEmailSender) can be swapped for an HTTP API provider
// without touching the callers. MAIL_ENABLED=false wires DisabledEmailSender
// (or LoggingEmailSender with the dev-only MAIL_LOG_SENDS=true).
// Every email currently goes out as the one configured account (MAIL_FROM).
// Sending as other identities (e.g. each org's own account via the Gmail API
// and OAuth) would add a sender identity to OutgoingEmail and let the
// implementation pick credentials per identity; callers stay the same.
public interface EmailSender {

    // Throws EmailSendException; its kind() tells the caller whether the
    // problem is this recipient's (skip it), temporary for this delivery
    // (retry a few times) or the transport's (stop, retry later).
    void send(OutgoingEmail email);

    // False when nothing can really be sent (MAIL_ENABLED=false): callers
    // refuse to start sending instead of pretending.
    default boolean enabled() {
        return true;
    }
}
