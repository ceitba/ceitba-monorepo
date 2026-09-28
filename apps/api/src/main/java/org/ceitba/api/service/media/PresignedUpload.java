package org.ceitba.api.service.media;

import java.time.Instant;
import java.util.Map;

// A signed PUT: the client must send exactly `headers` with the request.
public record PresignedUpload(
    String uploadUrl,
    Map<String, String> headers,
    Instant expiresAt
) {
    public PresignedUpload {
        headers = Map.copyOf(headers);
    }
}
