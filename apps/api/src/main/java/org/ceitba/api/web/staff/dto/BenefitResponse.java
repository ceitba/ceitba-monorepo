package org.ceitba.api.web.staff.dto;

import java.util.List;

public record BenefitResponse(
    String slug,
    String colorVar,
    int displayOrder,
    String linkUrl,
    String contactEmail,
    List<String> highlightsEs,
    List<String> highlightsEn
) {}
