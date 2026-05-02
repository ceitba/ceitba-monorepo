package org.ceitba.api.web.plan.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

// planId comes from the path; everything else from the body.
public record CreateSubjectPlanRequest(
    @NotBlank @Size(max = 32) String subjectId,
    @NotBlank @Size(max = 255) String section,
    Integer year,            // null -> stored as 0 (elective)
    Integer semester,        // null -> stored as 0 (elective)
    List<String> dependencies,    // null -> stored as []
    @Min(0) Integer creditsRequired   // null -> stored as 0 (NestJS behavior)
) {}
