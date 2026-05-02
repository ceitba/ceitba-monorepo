package org.ceitba.api.external.itba;

import java.util.List;

// Shape of a single subject-within-a-plan as returned by the ITBA API.
// Distinct from the JPA PlanSubject because (a) it carries the subject's
// name + credits inline, and (b) year/semester are nullable for entries
// that come from the "withoutTerm" branch of the response.
public record SubjectPlanProjection(
    String subjectId,
    String planId,
    String section,
    Integer year,
    Integer semester,
    List<String> dependencies,
    Integer creditsRequired,
    String subjectName,
    int subjectCredits
) {}
