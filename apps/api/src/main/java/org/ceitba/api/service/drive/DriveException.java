package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.DomainException;

// Drive-sync errors with a stable `error` code (docs/DRIVE-SYNC.md).
// GlobalExceptionHandler maps reason().status() and reason().code().
public class DriveException extends DomainException {

    public enum Reason {
        INVALID_FOLDER_URL("DRIVE_INVALID_FOLDER_URL", 400),
        FOLDER_NOT_SHARED("DRIVE_FOLDER_NOT_SHARED", 422),
        FOLDER_NOT_OWNED("DRIVE_FOLDER_NOT_OWNED", 403),
        SOURCE_EXISTS("DRIVE_SOURCE_EXISTS", 409),
        SYNC_RATE_LIMITED("DRIVE_SYNC_RATE_LIMITED", 429),
        SYNC_UNCONFIGURED("DRIVE_SYNC_UNCONFIGURED", 503);

        private final String code;
        private final int status;

        Reason(String code, int status) {
            this.code = code;
            this.status = status;
        }

        public String code() { return code; }
        public int status() { return status; }
    }

    private final Reason reason;
    private final long retryAfterSeconds;

    public DriveException(Reason reason, String message) {
        this(reason, message, 0);
    }

    public DriveException(Reason reason, String message, long retryAfterSeconds) {
        super(message);
        this.reason = reason;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public Reason reason() { return reason; }

    // Only for SYNC_RATE_LIMITED.
    public long retryAfterSeconds() { return retryAfterSeconds; }
}
