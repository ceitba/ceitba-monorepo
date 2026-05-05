package org.ceitba.api.web.staff.dto;

public record StaffDepartmentResponse(
    String slug,
    String colorVar,
    int displayOrder
) {}
