package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateBenefitCardRequest(
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
    List<String> bulletsEn,
    // Contact details (mobile app; all optional).
    String location,
    // Opened by the app: absolute http(s) URL, or blank to clear.
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String locationUrl,
    @Size(max = 64) String phone,
    // Opened by the app: absolute http(s) URL, or blank to clear.
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String website,
    @Email @Size(max = 255) String email
) {}
