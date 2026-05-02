package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CourseCommissionsResponse(CourseCommissions courseCommissions) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CourseCommissions(java.util.List<CourseCommission> courseCommission) {}
}
