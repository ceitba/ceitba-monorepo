package org.ceitba.api.web.subject.dto;

import java.util.List;
import java.util.Map;

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

    public record Commission(String name, List<Schedule> schedule) {}

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
