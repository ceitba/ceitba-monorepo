package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record UpdateStaffMemberRequest(
    @Min(2000) int year,
    @NotBlank String departmentSlug,
    int displayOrder,
    @NotBlank String name,
    @NotBlank String roleEs,
    @NotBlank String roleEn,
    String photoUrl,
    String linkedinUrl,
    String email
) {}
