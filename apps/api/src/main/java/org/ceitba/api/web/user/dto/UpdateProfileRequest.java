package org.ceitba.api.web.user.dto;

import jakarta.validation.constraints.Size;

// PATCH /v1/me/profile. Both fields optional; null = leave alone, empty
// string = clear. file_number is intentionally NOT here — it's identifying
// data and not editable from the profile page.
public record UpdateProfileRequest(
    @Size(max = 16) String careerId,
    @Size(max = 255) String plan
) {}
