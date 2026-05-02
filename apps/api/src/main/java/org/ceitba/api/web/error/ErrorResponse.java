package org.ceitba.api.web.error;

import java.time.Instant;

// Uniform error shape for every non-2xx response. Documented in OpenAPI so
// clients have a stable contract. Frozen at this size on purpose — adding
// fields makes parsing fragile downstream.
public record ErrorResponse(
    String error,
    String message,
    String path,
    Instant timestamp
) {
    public static ErrorResponse of(String error, String message, String path) {
        return new ErrorResponse(error, message, path, Instant.now());
    }
}
