package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record CreateBenefitCardRequest(
    @NotBlank String categorySlug,
    int displayOrder,
    @NotBlank String titleEs,
    @NotBlank String titleEn,
    String summaryEs,
    String summaryEn,
    String imageUrl,
    String ctaUrl,
    String ctaLabelEs,
    String ctaLabelEn,
    String price,
    List<String> bulletsEs,
    List<String> bulletsEn
) {}
