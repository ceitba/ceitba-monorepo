package org.ceitba.api.web.auth.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// Returned once at creation time; the raw key is never stored and cannot be retrieved again.
public record ApiKeyCreatedResponse(UUID id, String name, String key, OffsetDateTime expiresAt) {}
