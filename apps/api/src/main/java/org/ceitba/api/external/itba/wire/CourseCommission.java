package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CourseCommission(
    String subjectCode,
    String subjectName,
    String subjectType,
    String courseStart,
    String courseEnd,
    String commissionName,
    String commissionId,
    String quota,
    String enrolledStudents,
    List<CourseCommissionTime> courseCommissionTimes
) {}
