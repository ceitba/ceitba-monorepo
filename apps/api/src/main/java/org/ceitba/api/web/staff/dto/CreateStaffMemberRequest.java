package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateStaffMemberRequest(
    @Min(2000) int year,
    @NotBlank String departmentSlug,
    int displayOrder,
    @NotBlank String name,
    @NotBlank String roleEs,
    @NotBlank String roleEn,
    // Rendered by the public site as <img src> / <a href>: absolute http(s)
    // URL, or blank to clear (blocks javascript: and data: links).
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String photoUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String linkedinUrl,
    String email
) {}
