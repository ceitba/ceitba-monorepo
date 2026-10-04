package org.ceitba.api.service.mail;

// Transport-agnostic email sending (docs/WEEKLY-DIGEST.md). The SMTP
// implementation (SmtpEmailSender) can be swapped for an HTTP API provider
// without touching the callers. MAIL_ENABLED=false wires LoggingEmailSender.
public interface EmailSender {

    // Throws EmailSendException; its kind() tells the caller whether the
    // problem is this recipient's (skip it) or the transport's (stop, retry).
    void send(OutgoingEmail email);
}
