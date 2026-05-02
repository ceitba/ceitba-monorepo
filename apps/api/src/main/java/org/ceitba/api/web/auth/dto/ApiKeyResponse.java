package org.ceitba.api.web.auth.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ApiKeyResponse(
    UUID id,
    String name,
    OffsetDateTime createdAt,
    OffsetDateTime expiresAt,
    OffsetDateTime lastUsedAt
) {}
