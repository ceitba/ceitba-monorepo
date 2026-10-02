package org.ceitba.api.external.drive;

import java.util.Set;

// A failed Drive call. status is the HTTP status (0 = I/O error, no
// response); reason is Drive's error reason (e.g. notFound,
// rateLimitExceeded, exportSizeLimitExceeded) when it gave one.
public class DriveApiException extends RuntimeException {

    private static final Set<String> RATE_LIMIT_REASONS =
        Set.of("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded");

    private final int status;
    private final String reason;

    public DriveApiException(int status, String reason, String message) {
        super(message);
        this.status = status;
        this.reason = reason;
    }

    public DriveApiException(int status, String reason, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.reason = reason;
    }

    public int status() { return status; }
    public String reason() { return reason; }

    public boolean isRateLimited() {
        return status == 429 || (status == 403 && reason != null && RATE_LIMIT_REASONS.contains(reason));
    }

    // Worth retrying later: rate limits, 5xx, I/O.
    public boolean isTransient() {
        return isRateLimited() || status >= 500 || status == 0;
    }

    // The bot cannot see the item (missing, unshared, no permission).
    public boolean isNotFoundOrForbidden() {
        return status == 404 || (status == 403 && !isRateLimited() && !isExportTooLarge());
    }

    public boolean isExportTooLarge() {
        return "exportSizeLimitExceeded".equals(reason);
    }

    public static DriveApiException notFound(String id) {
        return new DriveApiException(404, "notFound", "File not found: " + id);
    }
}
