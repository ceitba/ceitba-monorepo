package org.ceitba.api.service.mail;

// Transport-agnostic email sending (docs/WEEKLY-DIGEST.md). The SMTP
// implementation (SmtpEmailSender) can be swapped for an HTTP API provider
// without touching the callers. MAIL_ENABLED=false wires LoggingEmailSender.
// The only EmailSender bean is MailSendService, which wraps the transport
// with the sending-quota ledger, so every caller is counted.
// Every email currently goes out as the one configured account (MAIL_FROM).
// Sending as other identities (e.g. each org's own account via the Gmail API
// and OAuth) would add a sender identity to OutgoingEmail and let the
// implementation pick credentials per identity; callers stay the same.
public interface EmailSender {

    // Throws EmailSendException; its kind() tells the caller whether the
    // problem is this recipient's (skip it) or the transport's / the
    // account's quota (stop, retry later). MailSendService also throws
    // MailQuotaExhaustedException without sending when no quota is left.
    void send(OutgoingEmail email);
}
