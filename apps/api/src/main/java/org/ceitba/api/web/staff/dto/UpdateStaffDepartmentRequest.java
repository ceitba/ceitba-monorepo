package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdateStaffDepartmentRequest(
    @NotBlank String colorVar,
    int displayOrder
) {}
