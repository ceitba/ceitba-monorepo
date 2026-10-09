package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// POST body. logoUrl/backgroundUrl are rendered as <img src> by the SPAs,
// so only http(s) is accepted (blank clears), like the staff/benefit URLs.
// The slug is the primary key and the newsletter URL segment
// (/newsletter/organizations/<slug>), and PATCH can't change it, so it is
// pinned to URL-safe kebab-case up front: lowercase letters/digits in
// hyphen-separated groups, 2-40 chars.
public record OrganizationRequest(
    @NotBlank
    @Size(min = 2, max = 40, message = "must be 2-40 characters")
    @Pattern(regexp = "^[a-z0-9]+(-[a-z0-9]+)*$",
             message = "must use only lowercase letters, digits and single hyphens between them")
    String slug,
    @NotBlank String name,
    @NotBlank String fullName,
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
