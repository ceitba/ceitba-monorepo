package org.ceitba.api.service.plan;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.web.plan.dto.SubjectPlanResponse;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class SubjectPlanService {

    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HHMMSS = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final ItbaApiClient itbaApiClient;
    private final CommissionRepository commissionRepository;
    private final PlanSubjectRepository planSubjectRepository;

    public SubjectPlanService(ItbaApiClient itbaApiClient,
                              CommissionRepository commissionRepository,
                              PlanSubjectRepository planSubjectRepository) {
        this.itbaApiClient = itbaApiClient;
        this.commissionRepository = commissionRepository;
        this.planSubjectRepository = planSubjectRepository;
    }

    // GET /api/v1/subjects?plan=... — the "organized" response. Subjects come
    // from the live ITBA API; commissions come from the DB cached by the sync
    // job. Mirrors NestJS SubjectPlanService.getSubjectsByPlanOrganized.
    @Transactional(readOnly = true)
    public Map<String, Map<String, Map<String, List<OrganizedSubjectsResponse.SubjectDetail>>>>
            getSubjectsByPlanOrganized(String planId) {
        var subjectPlans = itbaApiClient.getSubjectsByPlan(planId);
        if (subjectPlans.isEmpty()) {
            throw new ResourceNotFoundException("Plan", planId);
        }

        var commissions = commissionRepository.findAll();

        var organized = new LinkedHashMap<String, Map<String, Map<String, List<OrganizedSubjectsResponse.SubjectDetail>>>>();
        for (var sp : subjectPlans) {
            String section = sp.section();
            String year = sp.year() != null ? sp.year().toString() : "0";
            String semester = sp.semester() != null ? sp.semester().toString() : "0";

            var subjectCommissions = commissions.stream()
                .filter(c -> sp.subjectId().equals(c.getSubjectCode()))
                .toList();

            var commissionDtos = subjectCommissions.stream()
                .map(c -> new OrganizedSubjectsResponse.Commission(
                    c.getCommissionName(),
                    c.getTimes().stream()
                        .map(t -> new OrganizedSubjectsResponse.Schedule(
                            t.getDay().toString(),
                            t.getClassroom(),
                            t.getBuilding(),
                            t.getHourFrom().format(HHMMSS),
                            t.getHourTo().format(HHMMSS)
                        ))
                        .toList()
                ))
                .toList();

            String courseStart = subjectCommissions.isEmpty()
                ? LocalDate.now().format(ISO_DATE)
                : subjectCommissions.get(0).getCourseStart().format(ISO_DATE);
            String courseEnd = subjectCommissions.isEmpty()
                ? LocalDate.now().format(ISO_DATE)
                : subjectCommissions.get(0).getCourseEnd().format(ISO_DATE);

            var detail = new OrganizedSubjectsResponse.SubjectDetail(
                sp.section(),
                sp.subjectId(),
                sp.subjectName(),
                sp.subjectCredits(),
                sp.dependencies(),
                sp.creditsRequired(),
                courseStart,
                courseEnd,
                commissionDtos
            );

            organized
                .computeIfAbsent(section, k -> new LinkedHashMap<>())
                .computeIfAbsent(year, k -> new LinkedHashMap<>())
                .computeIfAbsent(semester, k -> new ArrayList<>())
                .add(detail);
        }
        return organized;
    }

    // GET /api/v1/plans/{planId}/subjects with optional filters — DB-only,
    // doesn't hit the external API.
    @Transactional(readOnly = true)
    public List<SubjectPlanResponse> getSubjectsByPlan(String planId, PlanFilters filters) {
        var rows = applyFilters(planId, filters);
        return rows.stream().map(this::toResponse).toList();
    }

    private List<org.ceitba.api.domain.PlanSubject> applyFilters(String planId, PlanFilters filters) {
        if (filters.year() != null && filters.semester() != null) {
            return planSubjectRepository.findByPlanIdAndYearAndSemester(planId, filters.year(), filters.semester());
        }
        if (filters.year() != null) {
            return planSubjectRepository.findByPlanIdAndYear(planId, filters.year());
        }
        if (filters.section() != null) {
            return planSubjectRepository.findByPlanIdAndSection(planId, filters.section());
        }
        if ("elective".equals(filters.type())) {
            return planSubjectRepository.findByPlanIdAndYearAndSemester(planId, 0, 0);
        }
        return planSubjectRepository.findByPlanId(planId);
    }

    private SubjectPlanResponse toResponse(org.ceitba.api.domain.PlanSubject ps) {
        // Subject inline shape needs name + credits — fetch lazily would N+1; do the DB lookup
        // explicitly. PlanSubject doesn't have a JPA association to Subject, intentionally
        // (the FK isn't even modeled in the schema). Look it up via the subject repo if needed.
        // For now, fields populated with what PlanSubject has — caller can enrich if needed.
        return new SubjectPlanResponse(
            ps.getSubjectId(),
            ps.getPlanId(),
            ps.getSection(),
            ps.getYear(),
            ps.getSemester(),
            ps.getDependencies(),
            ps.getCreditsRequired(),
            null
        );
    }

    public record PlanFilters(Integer year, Integer semester, String section, String type) {}
}
