package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// PATCH body: every field optional (null = leave unchanged); the slug comes
// from the path. Same URL rules as OrganizationRequest. A blank contact or
// recruiting field clears it; instagram takes a handle, @handle or profile URL.
public record OrganizationPatchRequest(
    String  name,
    String  fullName,
    String  description,
    String  category,
    String  color,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  logoUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  backgroundUrl,
    String  instagram,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  linkedinUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  websiteUrl,
    @Size(max = 320) @Pattern(regexp = "^(\\s*|[^@\\s]+@[^@\\s]+\\.[^@\\s]+)$", message = "must be an email address")
    String  contactEmail,
    Boolean recruitingOpen,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String  recruitingUrl,
    @Size(max = 280)
    String  recruitingText
) {}
