package org.ceitba.api.web.commission.dto;

import org.ceitba.api.domain.SubjectType;

import java.time.LocalDate;
import java.util.List;

// One row of GET /v1/commissions?plan=. Times are "HH:mm" (ART wall clock).
public record CommissionResponse(
    String id,
    String subjectCode,
    String subjectName,
    SubjectType subjectType,
    String commissionName,
    int quota,
    int enrolledStudents,
    LocalDate courseStart,
    LocalDate courseEnd,
    List<Time> times
) {

    public record Time(
        String day,
        String hourFrom,
        String hourTo,
        String building,
        String classroom
    ) {}
}
