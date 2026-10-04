package org.ceitba.api.service.digest;

import org.ceitba.api.common.exception.DomainException;

// Weekly digest errors with a stable `error` code (docs/WEEKLY-DIGEST.md).
// GlobalExceptionHandler maps reason().status() and reason().code().
public class DigestException extends DomainException {

    public enum Reason {
        INVALID_WEEK_START(400),
        DIGEST_EXISTS(409),
        DIGEST_NOT_EDITABLE(409),
        DIGEST_EMPTY(409),
        EMAIL_NOT_ALLOWED(422),
        INVALID_TOKEN(400),
        // Correction vote links ("¿Es así?").
        TOKEN_EXPIRED(410),
        INVALID_VOTE(400),
        CORRECTION_NOT_FOUND(404),
        // No longer PENDING/APPLIED, or its commission has ended.
        CORRECTION_CLOSED(409);

        private final int status;

        Reason(int status) {
            this.status = status;
        }

        public String code() { return name(); }
        public int status() { return status; }
    }

    private final Reason reason;

    public DigestException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
