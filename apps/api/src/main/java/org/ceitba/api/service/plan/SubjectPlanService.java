package org.ceitba.api.service.plan;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.PlanSubjectId;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.web.plan.dto.CreateSubjectPlanRequest;
import org.ceitba.api.web.plan.dto.SubjectPlanResponse;
import org.ceitba.api.web.plan.dto.UpdateSubjectPlanRequest;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SubjectPlanService {

    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    private final ItbaApiClient itbaApiClient;
    private final CommissionRepository commissionRepository;
    private final PlanSubjectRepository planSubjectRepository;
    private final PlanRepository planRepository;
    private final SubjectRepository subjectRepository;
    private final ScheduleCorrectionService scheduleCorrections;
    private final Clock clock;

    public SubjectPlanService(ItbaApiClient itbaApiClient,
                              CommissionRepository commissionRepository,
                              PlanSubjectRepository planSubjectRepository,
                              PlanRepository planRepository,
                              SubjectRepository subjectRepository,
                              ScheduleCorrectionService scheduleCorrections,
                              Clock clock) {
        this.itbaApiClient = itbaApiClient;
        this.commissionRepository = commissionRepository;
        this.planSubjectRepository = planSubjectRepository;
        this.planRepository = planRepository;
        this.subjectRepository = subjectRepository;
        this.scheduleCorrections = scheduleCorrections;
        this.clock = clock;
    }

    // GET /api/v1/subjects?plan=... — the "organized" response. Subjects come
    // from the live ITBA API; commissions come from the DB cached by the sync
    // job. Mirrors NestJS SubjectPlanService.getSubjectsByPlanOrganized.
    //
    // Deliberately NOT @Transactional: the ITBA call can take up to the
    // client's 30 s read timeout, and a surrounding transaction would pin a
    // pooled DB connection for all of it. The only DB read is a single
    // repository query (with its own read-only transaction) issued after the
    // external call returns; it hydrates `times`, so nothing lazy is touched
    // once the entities are detached.
    //
    // Student schedule corrections are overlaid on each commission (effective
    // schedule, sga_schedule, open corrections): two more queries for the
    // whole plan, see ScheduleCorrectionService.organizedCommissions. viewerId
    // (null when anonymous) only fills each correction's my_vote.
    public Map<String, Map<String, Map<String, List<OrganizedSubjectsResponse.SubjectDetail>>>>
            getSubjectsByPlanOrganized(String planId, UUID viewerId) {
        var subjectPlans = itbaApiClient.getSubjectsByPlan(planId);
        if (subjectPlans.isEmpty()) {
            throw new ResourceNotFoundException("Plan", planId);
        }

        var subjectCodes = subjectPlans.stream()
            .map(SubjectPlanProjection::subjectId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
        // One query for the plan's subjects with times fetched in the same
        // statement (no N+1 on commission_time), grouped per subject.
        Map<String, List<Commission>> commissionsBySubject = subjectCodes.isEmpty()
            ? Map.of()
            : commissionRepository.findBySubjectCodeInWithTimes(subjectCodes).stream()
                .collect(Collectors.groupingBy(Commission::getSubjectCode));
        LocalDate today = LocalDate.now(clock);
        Map<String, List<Commission>> currentBySubject = new LinkedHashMap<>();
        commissionsBySubject.forEach((code, list) -> currentBySubject.put(code, currentTerm(list, today)));
        var overlay = scheduleCorrections.organizedCommissions(
            currentBySubject.values().stream().flatMap(List::stream).toList(), viewerId);

        var organized = new LinkedHashMap<String, Map<String, Map<String, List<OrganizedSubjectsResponse.SubjectDetail>>>>();
        for (var sp : subjectPlans) {
            String section = sp.section();
            String year = sp.year() != null ? sp.year().toString() : "0";
            String semester = sp.semester() != null ? sp.semester().toString() : "0";

            var subjectCommissions = currentBySubject.getOrDefault(sp.subjectId(), List.of());

            var commissionDtos = subjectCommissions.stream()
                .map(c -> overlay.get(c.getId()))
                .toList();

            String courseStart = subjectCommissions.isEmpty()
                ? LocalDate.now(clock).format(ISO_DATE)
                : subjectCommissions.get(0).getCourseStart().format(ISO_DATE);
            String courseEnd = subjectCommissions.isEmpty()
                ? LocalDate.now(clock).format(ISO_DATE)
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

    // The commission table accumulates every term the sync job has ever seen
    // (rows are upserted by ITBA id and never pruned), so a subject offered in
    // both semesters has e.g. two "G" commissions: one from March–July and one
    // from July–December. Showing both duplicated every commission in the
    // response. Keep the commissions that have not ended yet (same rule as
    // GET /v1/commissions); if the subject has none — e.g. between terms,
    // before the next term is synced — fall back to its most recent term
    // (latest course_end) so the subject doesn't suddenly appear empty.
    // Genuinely concurrent offerings (two current terms of the same subject)
    // are distinct and are kept.
    static List<Commission> currentTerm(List<Commission> commissions, LocalDate today) {
        if (commissions.isEmpty()) {
            return commissions;
        }
        var notEnded = commissions.stream()
            .filter(c -> !c.getCourseEnd().isBefore(today))
            .toList();
        if (!notEnded.isEmpty()) {
            return notEnded;
        }
        LocalDate latestEnd = commissions.stream()
            .map(Commission::getCourseEnd)
            .max(Comparator.naturalOrder())
            .orElseThrow();
        return commissions.stream()
            .filter(c -> c.getCourseEnd().equals(latestEnd))
            .toList();
    }

    // GET /api/v1/plans/{planId}/subjects with optional filters — DB-only,
    // doesn't hit the external API.
    @Transactional(readOnly = true)
    public List<SubjectPlanResponse> getSubjectsByPlan(String planId, PlanFilters filters) {
        var rows = applyFilters(planId, filters);
        return rows.stream().map(this::toResponse).toList();
    }

    // GET /api/v1/plans/subjects/{subjectId}/plans — every plan that contains
    // a subject. Used by frontends that show "this subject appears in plans X, Y, Z".
    @Transactional(readOnly = true)
    public List<SubjectPlanResponse> getPlansForSubject(String subjectId) {
        return planSubjectRepository.findBySubjectId(subjectId).stream()
            .map(this::toResponse)
            .toList();
    }

    // GET /api/v1/plans/{planId}/subject/{subjectId} — one specific row.
    @Transactional(readOnly = true)
    public SubjectPlanResponse getOne(String planId, String subjectId) {
        var ps = planSubjectRepository.findById(new PlanSubjectId(subjectId, planId))
            .orElseThrow(() -> new ResourceNotFoundException(
                "SubjectPlan", planId + "/" + subjectId));
        return toResponse(ps);
    }

    // POST /api/v1/plans/{planId}/subject — STAFF only.
    // Validates planId + subjectId exist (no FK in the schema, so we have to
    // check at the application layer — otherwise rows reference nothing).
    @Transactional
    public SubjectPlanResponse create(String planId, CreateSubjectPlanRequest req) {
        if (!planRepository.existsById(planId)) {
            throw new ResourceNotFoundException("Plan", planId);
        }
        if (!subjectRepository.existsById(req.subjectId())) {
            throw new ResourceNotFoundException("Subject", req.subjectId());
        }
        var id = new PlanSubjectId(req.subjectId(), planId);
        if (planSubjectRepository.existsById(id)) {
            throw new ResourceAlreadyExistsException("SubjectPlan", planId + "/" + req.subjectId());
        }

        var entity = new PlanSubject(
            req.subjectId(),
            planId,
            req.section(),
            req.year() != null ? req.year() : 0,
            req.semester() != null ? req.semester() : 0,
            req.creditsRequired() != null ? req.creditsRequired() : 0,
            req.dependencies() != null ? req.dependencies() : List.of()
        );
        var saved = planSubjectRepository.save(entity);
        return toResponse(saved);
    }

    @Transactional
    public SubjectPlanResponse update(String planId, String subjectId, UpdateSubjectPlanRequest req) {
        var existing = planSubjectRepository.findById(new PlanSubjectId(subjectId, planId))
            .orElseThrow(() -> new ResourceNotFoundException(
                "SubjectPlan", planId + "/" + subjectId));

        // PlanSubject's mutable surface is intentionally narrow — fields are
        // final on the entity. Replace by save (PK is composite, INSERT or
        // UPDATE is decided by Hibernate via SELECT-then-decide).
        planSubjectRepository.delete(existing);
        planSubjectRepository.flush();

        var merged = new PlanSubject(
            subjectId, planId,
            req.section() != null ? req.section() : existing.getSection(),
            req.year() != null ? req.year() : existing.getYear(),
            req.semester() != null ? req.semester() : existing.getSemester(),
            req.creditsRequired() != null ? req.creditsRequired() : existing.getCreditsRequired(),
            req.dependencies() != null ? req.dependencies() : existing.getDependencies()
        );
        return toResponse(planSubjectRepository.save(merged));
    }

    @Transactional
    public void delete(String planId, String subjectId) {
        var id = new PlanSubjectId(subjectId, planId);
        if (!planSubjectRepository.existsById(id)) {
            throw new ResourceNotFoundException("SubjectPlan", planId + "/" + subjectId);
        }
        planSubjectRepository.deleteById(id);
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

    // Enriches the response with the subject's name + credits when we have it.
    // PlanSubject has no JPA association to Subject (the FK isn't in the schema)
    // so we look it up; subjectRepository.findById is hashable + small.
    private SubjectPlanResponse toResponse(PlanSubject ps) {
        var subjectShape = subjectRepository.findById(ps.getSubjectId())
            .map(s -> new SubjectPlanResponse.SubjectShape(s.getId(), s.getName(), s.getCredits()))
            .orElse(null);
        return new SubjectPlanResponse(
            ps.getSubjectId(),
            ps.getPlanId(),
            ps.getSection(),
            ps.getYear(),
            ps.getSemester(),
            ps.getDependencies(),
            ps.getCreditsRequired(),
            subjectShape
        );
    }

    public record PlanFilters(Integer year, Integer semester, String section, String type) {}
}
