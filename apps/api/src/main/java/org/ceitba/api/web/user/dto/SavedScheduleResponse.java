package org.ceitba.api.web.user.dto;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record SavedScheduleResponse(
    UUID id,
    String name,
    String careerId,
    String plan,
    Map<String, Object> payload,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
