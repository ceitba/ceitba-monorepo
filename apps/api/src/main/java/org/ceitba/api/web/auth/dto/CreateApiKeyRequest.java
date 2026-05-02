package org.ceitba.api.web.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record CreateApiKeyRequest(
    @NotBlank String name,
    @Positive Integer ttlDays   // null → default 365 days
) {}
