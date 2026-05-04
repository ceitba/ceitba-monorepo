package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;

public record OrganizationRequest(
    @NotBlank String slug,
    @NotBlank String name,
    @NotBlank String fullName,
    String  description,
    String  category,
    String  color,
    int     memberCount,
    String  logoUrl,
    String  backgroundUrl
) {}
