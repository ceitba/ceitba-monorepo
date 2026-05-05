package org.ceitba.api.web.staff.dto;

import java.util.UUID;

public record StaffMemberResponse(
    UUID id,
    int year,
    String departmentSlug,
    int displayOrder,
    String name,
    String roleEs,
    String roleEn,
    String photoUrl,
    String linkedinUrl,
    String email
) {}
