package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SourceResponse(
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
    // A community source (archive folder, no owning student).
    boolean community
) {}
