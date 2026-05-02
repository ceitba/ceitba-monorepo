package org.ceitba.api.web.plan.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import java.util.List;

// All fields optional; null means "leave it as it was".
public record UpdateSubjectPlanRequest(
    @Size(max = 255) String section,
    Integer year,
    Integer semester,
    List<String> dependencies,
    @Min(0) Integer creditsRequired
) {}
