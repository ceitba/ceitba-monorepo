package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// PATCH body: every field optional (null = leave unchanged); the slug comes
// from the path. Same URL rules as OrganizationRequest.
public record OrganizationPatchRequest(
    String  name,
    String  fullName,
    String  description,
    String  category,
    String  color,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  logoUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  backgroundUrl
) {}
