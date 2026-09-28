package org.ceitba.api.web.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record SavedScheduleResponse(
    UUID id,
    String name,
    String careerId,
    String plan,
    Map<String, Object> payload,
    // Explicit name: Jackson would otherwise derive "primary" from isPrimary().
    @JsonProperty("isPrimary") boolean isPrimary,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
