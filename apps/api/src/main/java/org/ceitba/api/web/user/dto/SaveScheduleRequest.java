package org.ceitba.api.web.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Map;

// POST/PUT body for /v1/me/schedules. The payload is opaque — we only check
// it's an object (Map). Hibernate will reject anything else at JSONB time.
public record SaveScheduleRequest(
    @NotBlank @Size(max = 120) String name,
    @Size(max = 16)  String careerId,
    @Size(max = 255) String plan,
    @NotNull Map<String, Object> payload
) {}
