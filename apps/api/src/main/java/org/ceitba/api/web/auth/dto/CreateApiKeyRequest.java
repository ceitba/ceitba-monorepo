package org.ceitba.api.web.auth.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record CreateApiKeyRequest(
    @NotBlank String name,
    @Positive @Max(365) Integer ttlDays   // null → default 365 days
) {}
