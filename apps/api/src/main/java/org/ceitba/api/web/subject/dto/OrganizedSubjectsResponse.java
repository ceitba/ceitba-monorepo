package org.ceitba.api.web.subject.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Response of GET /api/v1/subjects?plan=...
//
// Shape: { section: { year: { semester: [SubjectDetail, ...] } } }
// Mirrors the NestJS SectionSubjectsDto byte-for-byte.
public final class OrganizedSubjectsResponse {

    public record SubjectDetail(
        String section,
        String subject_id,
        String name,
        int credits,
        List<String> dependencies,
        Integer credits_required,
        String course_start,
        String course_end,
        List<Commission> commissions
    ) {}

    // `schedule` is the EFFECTIVE schedule: an applied student correction's
    // slots when there is one (see ScheduleCorrectionService), else the SGA
    // slots. `sga_schedule` (the original SGA slots) is present only when a
    // correction is applied. `corrections` lists the open (PENDING/APPLIED)
    // corrections, APPLIED first, then by confirms descending.
    public record Commission(
        String commission_id,
        String name,
        List<Schedule> schedule,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<Schedule> sga_schedule,
        List<Correction> corrections
    ) {}

    // No suggester/voter identity, ever. my_vote is the caller's own vote,
    // null for anonymous callers or when they have not voted.
    public record Correction(
        UUID id,
        String status,
        List<Schedule> schedule,
        int confirms,
        int rejects,
        String my_vote,
        Instant created_at
    ) {}

    public record Schedule(
        String day,
        String classroom,
        String building,
        String time_from,
        String time_to
    ) {}

    private OrganizedSubjectsResponse() {}

    public static Map<String, Map<String, Map<String, List<SubjectDetail>>>> empty() {
        return Map.of();
    }
}
