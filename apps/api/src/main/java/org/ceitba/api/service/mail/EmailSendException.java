package org.ceitba.api.service.mail;

import org.ceitba.api.common.exception.DomainException;

public class EmailSendException extends DomainException {

    public enum Kind {
        // This recipient/message was rejected (bad address, malformed message):
        // record it as failed and go on with the next one.
        RECIPIENT,
        // The transport is unusable right now (authentication, sending quota,
        // connection, 4xx): stop the batch and retry later.
        TRANSIENT
    }

    private final Kind kind;

    public EmailSendException(Kind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
    }

    public Kind kind() { return kind; }
}
