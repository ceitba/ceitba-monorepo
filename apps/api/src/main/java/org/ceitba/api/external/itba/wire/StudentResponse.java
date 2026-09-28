package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

// GET /students/{token}/{dni}. `code` is the student file number (legajo),
// `careerCode` the SGA career code (matches careers.id), and
// activeCareerPlans.careerPlans is object-or-array like the rest of the ITBA
// wire format (see CareerPlansResponse).
@JsonIgnoreProperties(ignoreUnknown = true)
public record StudentResponse(
    String code,
    String career,
    String careerCode,
    ActiveCareerPlans activeCareerPlans
) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ActiveCareerPlans(List<StudentCareerPlan> careerPlans) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StudentCareerPlan(String name) {}
}
