package org.ceitba.api.service.commission;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.web.commission.dto.CommissionResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// Flat commission catalog for the app's schedule builder. DB-only: it reads
// what the DataSyncJob cached from ITBA and never calls ITBA per request.
@Service
public class CommissionService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final CommissionRepository commissionRepository;
    private final PlanRepository planRepository;
    private final PlanSubjectRepository planSubjectRepository;
    private final SubjectRepository subjectRepository;
    private final Clock clock;

    public CommissionService(CommissionRepository commissionRepository,
                             PlanRepository planRepository,
                             PlanSubjectRepository planSubjectRepository,
                             SubjectRepository subjectRepository,
                             Clock clock) {
        this.commissionRepository = commissionRepository;
        this.planRepository = planRepository;
        this.planSubjectRepository = planSubjectRepository;
        this.subjectRepository = subjectRepository;
        this.clock = clock;
    }

    // GET /v1/commissions?plan= — commissions of the plan's subjects whose
    // course has not ended (course_end >= today in ART).
    @Transactional(readOnly = true)
    public List<CommissionResponse> currentByPlan(String planId) {
        if (!planRepository.existsById(planId) && !planSubjectRepository.existsByPlanId(planId)) {
            throw new ResourceNotFoundException("Plan", planId);
        }
        var commissions = commissionRepository.findCurrentByPlanWithTimes(planId, LocalDate.now(clock));
        var codes = commissions.stream().map(Commission::getSubjectCode).distinct().toList();
        Map<String, String> names = subjectRepository.findAllById(codes).stream()
            .collect(Collectors.toMap(Subject::getId, Subject::getName));
        return commissions.stream().map(c -> toResponse(c, names)).toList();
    }

    private static CommissionResponse toResponse(Commission c, Map<String, String> names) {
        return new CommissionResponse(
            c.getId(),
            c.getSubjectCode(),
            names.get(c.getSubjectCode()),
            c.getSubjectType(),
            c.getCommissionName(),
            c.getQuota(),
            c.getEnrolledStudents(),
            c.getCourseStart(),
            c.getCourseEnd(),
            c.getTimes().stream()
                .map(t -> new CommissionResponse.Time(
                    t.getDay().name(),
                    t.getHourFrom().format(HH_MM),
                    t.getHourTo().format(HH_MM),
                    t.getBuilding(),
                    t.getClassroom()))
                .toList()
        );
    }
}
