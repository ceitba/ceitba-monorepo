package org.ceitba.api.external.itba;

import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.SubjectType;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

public record CommissionProjection(
    String id,
    String subjectCode,
    String subjectName,
    String commissionName,
    LocalDate courseStart,
    LocalDate courseEnd,
    int enrolledStudents,
    int quota,
    SubjectType subjectType,
    List<TimeSlot> times
) {
    public record TimeSlot(
        DayOfWeek day,
        String classroom,
        String building,
        LocalTime hourFrom,
        LocalTime hourTo
    ) {}
}
