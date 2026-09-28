package org.ceitba.api.external.itba;

import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.external.itba.wire.CareerPlansResponse;
import org.ceitba.api.external.itba.wire.CourseCommission;
import org.ceitba.api.external.itba.wire.CourseCommissionTime;
import org.ceitba.api.external.itba.wire.CourseCommissionsResponse;
import org.ceitba.api.external.itba.wire.Section;
import org.ceitba.api.external.itba.wire.SubjectEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Real impl. Disabled when itba.api.use-fake=true (used by tests). The
// FakeItbaApiClient bean takes over in that case.
@Component
@ConditionalOnProperty(name = "itba.api.use-fake", havingValue = "false", matchIfMissing = true)
public class RestClientItbaApiClient implements ItbaApiClient {

    private static final Logger log = LoggerFactory.getLogger(RestClientItbaApiClient.class);
    // ITBA dates come in dd/MM/yy form (e.g. "21/07/25"). They never use 4-digit years.
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("dd/MM/yy");

    private final RestClient client;
    private final String token;
    private final Clock clock;

    public RestClientItbaApiClient(RestClient itbaRestClient,
                                   @Value("${itba.api.token:}") String token,
                                   Clock clock) {
        this.client = itbaRestClient;
        this.token = token;
        this.clock = clock;
    }

    @Override
    public List<SubjectPlanProjection> getSubjectsByPlan(String planId) {
        try {
            var response = client.get()
                .uri(uri -> uri.path("/careerPlans/{token}").queryParam("plan", planId).build(token))
                .retrieve()
                .body(CareerPlansResponse.class);

            if (response == null || response.careerPlan() == null) {
                throw new ExternalApiException("ITBA", "getSubjectsByPlan", null);
            }

            var out = new ArrayList<SubjectPlanProjection>();
            var sections = response.careerPlan().section();
            if (sections != null) {
                for (var section : sections) {
                    processSection(section, planId, out);
                }
            }
            return out;
        } catch (ExternalApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ExternalApiException("ITBA", "getSubjectsByPlan", e);
        }
    }

    @Override
    public List<CommissionProjection> getCommissions(CommissionQuery query) {
        var q = query.withDefaultsFilled(clock);
        var out = new ArrayList<CommissionProjection>();

        for (var level : q.levels()) {
            try {
                var response = client.get()
                    .uri(uri -> uri.path("/courseCommissions/{token}")
                        .queryParam("level", level)
                        .queryParam("year", q.year().toString())
                        .queryParam("period", q.period())
                        .build(token))
                    .retrieve()
                    .body(CourseCommissionsResponse.class);

                if (response == null || response.courseCommissions() == null
                    || response.courseCommissions().courseCommission() == null) {
                    log.warn("No commission data received for level {}", level);
                    continue;
                }

                for (var course : response.courseCommissions().courseCommission()) {
                    if (course == null || course.courseCommissionTimes() == null) {
                        log.warn("Skipping course without times: {}", course == null ? null : course.subjectName());
                        continue;
                    }
                    // Skip 99.52 / 99.56 — historically excluded, see NestJS comment "ITBA"
                    if ("99.52".equals(course.subjectCode()) || "99.56".equals(course.subjectCode())) {
                        continue;
                    }
                    out.add(toCommission(course));
                }
            } catch (Exception e) {
                throw new ExternalApiException("ITBA", "getCommissions(level=" + level + ")", e);
            }
        }
        return out;
    }

    @Override
    public List<CommissionProjection> getCommissionsBySubject(String subjectCode, CommissionQuery query) {
        return getCommissions(query).stream()
            .filter(c -> subjectCode.equals(c.subjectCode()))
            .toList();
    }

    private void processSection(Section section, String planId, List<SubjectPlanProjection> out) {
        if (section.terms() != null && section.terms().term() != null) {
            for (var term : section.terms().term()) {
                if (term.entries() == null || term.entries().entry() == null) continue;
                for (var entry : term.entries().entry()) {
                    if (!"subject".equals(entry.type())) continue;
                    out.add(toProjection(entry, planId, section.name(),
                        parseIntOrNull(term.year()), parseIntOrNull(term.period())));
                }
            }
        } else if (section.withoutTerm() != null && section.withoutTerm().entries() != null) {
            for (var entry : section.withoutTerm().entries()) {
                if (!"subject".equals(entry.type())) continue;
                out.add(toProjection(entry, planId, section.name(), null, null));
            }
        }
    }

    private SubjectPlanProjection toProjection(SubjectEntry entry, String planId, String section,
                                               Integer year, Integer semester) {
        List<String> deps = entry.dependencies() != null && entry.dependencies().dependency() != null
            ? List.copyOf(entry.dependencies().dependency())
            : List.of();
        Integer credsRequired = entry.creditsRequired() != null ? Integer.parseInt(entry.creditsRequired()) : null;
        return new SubjectPlanProjection(
            entry.code(), planId, section, year, semester, deps, credsRequired,
            entry.name(), Integer.parseInt(entry.credits())
        );
    }

    private CommissionProjection toCommission(CourseCommission src) {
        var times = mapTimes(src);
        return new CommissionProjection(
            src.commissionId(),
            src.subjectCode(),
            src.subjectName(),
            src.commissionName(),
            parseDate(src.courseStart()),
            parseDate(src.courseEnd()),
            Integer.parseInt(src.enrolledStudents()),
            Integer.parseInt(src.quota()),
            mapSubjectType(src.subjectType()),
            times
        );
    }

    private List<CommissionProjection.TimeSlot> mapTimes(CourseCommission src) {
        // Dedup by (commissionId, day, hourFrom) — same key as the PG composite PK
        Map<String, CommissionProjection.TimeSlot> unique = new HashMap<>();
        for (CourseCommissionTime t : src.courseCommissionTimes()) {
            if (t == null) continue;
            var building = normalizeBuilding(t.building());
            var classroom = t.classRoom() != null ? t.classRoom() : "Virtual Asincrónico";
            var hourFrom = LocalTime.parse(t.hourFrom());
            var hourTo = LocalTime.parse(t.hourTo());
            var slot = new CommissionProjection.TimeSlot(
                mapDay(t.day()), classroom, building, hourFrom, hourTo);
            unique.putIfAbsent(src.commissionId() + "|" + slot.day() + "|" + slot.hourFrom(), slot);
        }
        return List.copyOf(unique.values());
    }

    private static String normalizeBuilding(String building) {
        if (building == null) return "Online";
        return switch (building) {
            case "External" -> "Online";
            case "Sede Distrito Financiero" -> "SDF";
            case "Sede Rectorado" -> "SDR";
            default -> building;
        };
    }

    private static DayOfWeek mapDay(String day) {
        if (day == null) return DayOfWeek.MONDAY;
        try {
            return DayOfWeek.valueOf(day.toUpperCase());
        } catch (IllegalArgumentException e) {
            return DayOfWeek.MONDAY;
        }
    }

    private static SubjectType mapSubjectType(String type) {
        if (type == null) return SubjectType.SEMESTRAL;
        try {
            return SubjectType.valueOf(type.toUpperCase());
        } catch (IllegalArgumentException e) {
            return SubjectType.SEMESTRAL;
        }
    }

    private static LocalDate parseDate(String s) {
        return LocalDate.parse(s, DATE_FMT);
    }

    private static Integer parseIntOrNull(String s) {
        if (s == null) return null;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
