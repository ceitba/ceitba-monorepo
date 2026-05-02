package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CourseCommissionTime(
    String day,
    String classRoom,
    String building,
    String hourFrom,
    String hourTo
) {}
