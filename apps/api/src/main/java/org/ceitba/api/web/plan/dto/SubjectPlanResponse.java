package org.ceitba.api.web.plan.dto;

import java.util.List;

// Mirrors the NestJS SubjectPlanDto. Returned by /v1/plans/{planId}/subjects
// (the simple, DB-only filter endpoint).
public record SubjectPlanResponse(
    String subjectId,
    String planId,
    String section,
    Integer year,
    Integer semester,
    List<String> dependencies,
    Integer creditsRequired,
    SubjectShape subject
) {
    public record SubjectShape(String id, String name, int credits) {}
}
