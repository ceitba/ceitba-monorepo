package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// POST body. logoUrl/backgroundUrl are rendered as <img src> by the SPAs,
// so only http(s) is accepted (blank clears), like the staff/benefit URLs.
public record OrganizationRequest(
    @NotBlank String slug,
    @NotBlank String name,
    @NotBlank String fullName,
    String  description,
    String  category,
    String  color,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  logoUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  backgroundUrl
) {}
