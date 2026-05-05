package org.ceitba.api.web.user.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// PATCH /v1/me/preferences. Both fields optional; null means "leave as is".
// Empty string clears the value (revert to SPA default).
public record UpdatePreferencesRequest(
    @Pattern(regexp = "light|dark|", message = "theme must be 'light' or 'dark'")
    String theme,

    @Size(max = 5, message = "language code too long")
    String language
) {}
