package org.ceitba.api.web.media.dto;

import java.time.Instant;
import java.util.Map;

// uploadUrl: PUT the file bytes here before expiresAt, sending exactly
// `headers` (Content-Type and Content-Length are signed).
// key: the object key to hand back to the API (e.g. POST /v1/proposals).
// publicUrl: where the object is readable once uploaded.
public record SignUploadResponse(
    String uploadUrl,
    String publicUrl,
    String key,
    String method,
    Map<String, String> headers,
    Instant expiresAt
) {}
