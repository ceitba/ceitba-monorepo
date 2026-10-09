package org.ceitba.api.web.subject.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Response of GET /api/v1/subjects?plan=...
//
// Shape: { section: { year: { semester: [SubjectDetail, ...] } } }
// Started as the NestJS SectionSubjectsDto; since then commissions carry
// their own dates and subjects a past_term flag.
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
        List<Commission> commissions,
        // True when no commission of the subject is still running and the
        // ones listed are its most recent ended term (the CommissionTerms
        // fallback): the subject is probably not offered this term.
        boolean past_term
    ) {}

    // `schedule` is the EFFECTIVE schedule: an applied student correction's
    // slots when there is one (see ScheduleCorrectionService), else the SGA
    // slots. `sga_schedule` (the original SGA slots) is present only when a
    // correction is applied. `corrections` lists the open (PENDING/APPLIED)
    // corrections, APPLIED first, then by confirms descending.
    // course_start/course_end are this commission's own "YYYY-MM-DD" dates: a
    // subject's commissions can differ (bimester modules, year-long cohorts).
    public record Commission(
        String commission_id,
        String name,
        String course_start,
        String course_end,
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
