package org.ceitba.api.web.auth.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateApiKeyRequest(
    @NotBlank String name,
    @Positive @Max(365) Integer ttlDays,   // null → default 365 days
    // Subset of "read", "report", "write", "staff" (ApiKeyScope). null → all
    // (full power, the pre-scopes behaviour); [] → read only. "read" is always
    // implied, and "write" implies "report".
    @Size(max = 4) List<String> scopes
) {
    public CreateApiKeyRequest(String name, Integer ttlDays) {
        this(name, ttlDays, null);
    }
}
