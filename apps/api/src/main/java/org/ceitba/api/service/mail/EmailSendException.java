package org.ceitba.api.service.mail;

import org.ceitba.api.common.exception.DomainException;

public class EmailSendException extends DomainException {

    public enum Kind {
        // This recipient/message was rejected for good (bad address, mailbox
        // full, malformed message): record it as failed, go on with the next.
        RECIPIENT,
        // Temporary and scoped to this delivery (a 4.x.x reply that is not the
        // account's fault): retry it later, give up after a few attempts, and
        // never hold up the other recipients.
        TRANSIENT,
        // The account/connection is unusable right now (authentication,
        // throttling, connection, unknown errors): stop the batch and retry
        // later; no delivery is blamed (MailSendService backs off).
        TRANSPORT,
        // The provider says the account's sending limit is used up (Gmail
        // "550 5.4.5 Daily user sending limit exceeded"): authoritative, the
        // account is paused for a day (MailSendService).
        QUOTA
    }

    private final Kind kind;

    public EmailSendException(Kind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
    }

    public Kind kind() { return kind; }
}
