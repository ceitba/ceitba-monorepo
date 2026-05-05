package org.ceitba.api.web.staff.dto;

import java.util.List;
import java.util.UUID;

public record BenefitCardResponse(
    UUID id,
    String categorySlug,
    int displayOrder,
    String titleEs,
    String titleEn,
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
