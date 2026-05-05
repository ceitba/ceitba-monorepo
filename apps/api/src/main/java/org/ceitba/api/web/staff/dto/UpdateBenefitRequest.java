package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record UpdateBenefitRequest(
    @NotBlank String colorVar,
    int displayOrder,
    String linkUrl,
    String contactEmail,
    List<String> highlightsEs,
    List<String> highlightsEn
) {}
