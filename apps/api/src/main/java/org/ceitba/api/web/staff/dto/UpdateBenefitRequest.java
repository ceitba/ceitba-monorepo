package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateBenefitRequest(
    @NotBlank String colorVar,
    int displayOrder,
    String linkUrl,
    String contactEmail,
    List<String> highlightsEs,
    List<String> highlightsEn,
    // Category display names (optional; the SPA falls back to i18n keys).
    @Size(max = 255) String nameEs,
    @Size(max = 255) String nameEn
) {}
