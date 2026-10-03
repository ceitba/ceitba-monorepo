package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

// Source + the owner, always visible to STAFF (even for anonymous sources).
public record StaffSourceResponse(
    UUID id,
    String rootName,
    String status,
    boolean anonymous,
    OffsetDateTime lastSyncedAt,
    String lastError,
    long fileCount,
    long publishedCount,
    long needsReviewCount,
    OffsetDateTime createdAt,
    String ownerName,
    String ownerEmail
) {}
