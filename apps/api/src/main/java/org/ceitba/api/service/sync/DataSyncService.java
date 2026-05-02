package org.ceitba.api.service.sync;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.PlanSubjectId;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.external.itba.CommissionProjection;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

// Pulls the latest snapshot from the ITBA API and upserts subjects,
// plan-subjects, and commissions into the local DB. One transaction per
// plan / commission level — a bad row in plan A doesn't roll back plan B.
@Service
public class DataSyncService {

    private static final Logger log = LoggerFactory.getLogger(DataSyncService.class);

    private final ItbaApiClient itbaApiClient;
    private final CareerRepository careerRepository;
    private final PlanRepository planRepository;
    private final SubjectRepository subjectRepository;
    private final PlanSubjectRepository planSubjectRepository;
    private final CommissionRepository commissionRepository;

    public DataSyncService(ItbaApiClient itbaApiClient,
                           CareerRepository careerRepository,
                           PlanRepository planRepository,
                           SubjectRepository subjectRepository,
                           PlanSubjectRepository planSubjectRepository,
                           CommissionRepository commissionRepository) {
        this.itbaApiClient = itbaApiClient;
        this.careerRepository = careerRepository;
        this.planRepository = planRepository;
        this.subjectRepository = subjectRepository;
        this.planSubjectRepository = planSubjectRepository;
        this.commissionRepository = commissionRepository;
    }

    public DataSyncResult syncAll(CommissionQuery commissionQuery) {
        long t0 = System.currentTimeMillis();
        log.info("Starting full data sync");
        var result = new DataSyncResult();
        try {
            syncSubjectsAndPlans(result);
            syncCommissions(result, commissionQuery != null ? commissionQuery : CommissionQuery.defaults());
            return result;
        } finally {
            result.finish(System.currentTimeMillis() - t0);
            log.info("Full data sync done in {} ms (processed={})",
                result.getDuration(), result.getTotalProcessed());
        }
    }

    public DataSyncResult syncSubjectsAndPlansOnly() {
        long t0 = System.currentTimeMillis();
        var result = new DataSyncResult();
        try {
            syncSubjectsAndPlans(result);
            return result;
        } finally {
            result.finish(System.currentTimeMillis() - t0);
        }
    }

    public DataSyncResult syncCommissionsOnly(CommissionQuery query) {
        long t0 = System.currentTimeMillis();
        var result = new DataSyncResult();
        try {
            syncCommissions(result, query != null ? query : CommissionQuery.defaults());
            return result;
        } finally {
            result.finish(System.currentTimeMillis() - t0);
        }
    }

    public List<SubjectPlanProjection> syncByPlan(String planId) {
        var entries = itbaApiClient.getSubjectsByPlan(planId);
        var result = new DataSyncResult();
        upsertPlanEntries(planId, entries, result);
        return entries;
    }

    public List<CommissionProjection> syncCommissionsBySubject(String subjectCode, CommissionQuery query) {
        var commissions = itbaApiClient.getCommissionsBySubject(subjectCode,
            query != null ? query : CommissionQuery.defaults());
        var result = new DataSyncResult();
        for (var c : commissions) {
            upsertOneCommission(c, result);
        }
        return commissions;
    }

    private void syncSubjectsAndPlans(DataSyncResult result) {
        log.info("Syncing subjects + plans");
        // Walk every plan attached to a known career and pull from the API
        for (var career : careerRepository.findAll()) {
            for (var plan : planRepository.findByCareer_Id(career.getId())) {
                try {
                    var entries = itbaApiClient.getSubjectsByPlan(plan.getId());
                    upsertPlanEntries(plan.getId(), entries, result);
                } catch (Exception e) {
                    log.error("Failed to sync plan {} (career {})", plan.getId(), career.getId(), e);
                    result.subjectPlans().errors++;
                }
            }
        }
    }

    // One transaction per plan — a bad row in plan A shouldn't roll back B.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void upsertPlanEntries(String planId, List<SubjectPlanProjection> entries, DataSyncResult result) {
        for (var entry : entries) {
            try {
                upsertSubject(entry, result);
                upsertPlanSubject(entry, result);
            } catch (Exception e) {
                log.error("Failed to upsert plan subject {}/{}", planId, entry.subjectId(), e);
                result.subjectPlans().errors++;
            }
        }
    }

    private void upsertSubject(SubjectPlanProjection entry, DataSyncResult result) {
        Optional<Subject> existing = subjectRepository.findById(entry.subjectId());
        if (existing.isPresent()) {
            var s = existing.get();
            if (!s.getName().equals(entry.subjectName()) || s.getCredits() != entry.subjectCredits()) {
                s.setName(entry.subjectName());
                s.setCredits(entry.subjectCredits());
                subjectRepository.save(s);
                result.subjects().updated++;
            }
        } else {
            subjectRepository.save(new Subject(entry.subjectId(), entry.subjectName(), entry.subjectCredits()));
            result.subjects().created++;
        }
    }

    private void upsertPlanSubject(SubjectPlanProjection entry, DataSyncResult result) {
        var id = new PlanSubjectId(entry.subjectId(), entry.planId());
        Optional<PlanSubject> existing = planSubjectRepository.findById(id);
        var ps = new PlanSubject(
            entry.subjectId(), entry.planId(),
            entry.section() != null ? entry.section() : "",
            entry.year() != null ? entry.year() : 0,
            entry.semester() != null ? entry.semester() : 0,
            entry.creditsRequired() != null ? entry.creditsRequired() : 0, // schema is NOT NULL; default 0
            entry.dependencies() != null ? entry.dependencies() : List.of()
        );
        if (existing.isEmpty()) {
            planSubjectRepository.save(ps);
            result.subjectPlans().created++;
        } else if (planSubjectChanged(existing.get(), ps)) {
            planSubjectRepository.save(ps);
            result.subjectPlans().updated++;
        }
    }

    private boolean planSubjectChanged(PlanSubject a, PlanSubject b) {
        return !a.getSection().equals(b.getSection())
            || a.getYear() != b.getYear()
            || a.getSemester() != b.getSemester()
            || !java.util.Objects.equals(a.getCreditsRequired(), b.getCreditsRequired())
            || !sortedEquals(a.getDependencies(), b.getDependencies());
    }

    private boolean sortedEquals(List<String> a, List<String> b) {
        var sa = new java.util.ArrayList<>(a); java.util.Collections.sort(sa);
        var sb = new java.util.ArrayList<>(b); java.util.Collections.sort(sb);
        return sa.equals(sb);
    }

    private void syncCommissions(DataSyncResult result, CommissionQuery query) {
        var q = query.withDefaultsFilled();
        log.info("Syncing commissions year={} period={} levels={}", q.year(), q.period(), q.levels());

        List<CommissionProjection> commissions;
        try {
            commissions = itbaApiClient.getCommissions(query);
        } catch (Exception e) {
            log.error("Failed to fetch commissions from ITBA API", e);
            throw e;
        }
        if (commissions.isEmpty()) {
            log.warn("No commissions returned from ITBA API");
            return;
        }

        // Backfill any missing subjects so the FKs hold (mirrors NestJS behavior;
        // commission can reference a subject not yet in the plan-walk).
        var existingSubjectIds = new java.util.HashSet<String>();
        subjectRepository.findAll().forEach(s -> existingSubjectIds.add(s.getId()));

        for (var c : commissions) {
            if (!existingSubjectIds.contains(c.subjectCode())) {
                try {
                    // Use the commission's subjectName when available, fall back to the
                    // code if absent (which is what NestJS used to do for ALL backfills).
                    String name = c.subjectName() != null && !c.subjectName().isBlank()
                        ? c.subjectName()
                        : c.subjectCode();
                    subjectRepository.save(new Subject(c.subjectCode(), name, 0));
                    existingSubjectIds.add(c.subjectCode());
                    result.subjects().created++;
                } catch (Exception e) {
                    log.error("Failed to backfill subject {}", c.subjectCode(), e);
                    result.subjects().errors++;
                }
            }
        }

        for (var c : commissions) {
            try {
                upsertOneCommission(c, result);
            } catch (Exception e) {
                log.error("Failed to upsert commission {}", c.id(), e);
                result.commissions().errors++;
            }
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void upsertOneCommission(CommissionProjection projection, DataSyncResult result) {
        Optional<Commission> existing = commissionRepository.findById(projection.id());
        var commission = existing.orElseGet(() -> new Commission(
            projection.id(), projection.subjectCode(), projection.commissionName(),
            projection.courseStart(), projection.courseEnd(),
            projection.enrolledStudents(), projection.quota(), projection.subjectType()));

        // Refresh mutable fields
        commission.setEnrolledStudents(projection.enrolledStudents());
        commission.setQuota(projection.quota());

        commission.getTimes().clear();
        for (var slot : projection.times()) {
            commission.getTimes().add(new CommissionTime(
                projection.id(), slot.day(), slot.hourFrom(),
                slot.classroom(), slot.building(), slot.hourTo()));
        }

        commissionRepository.save(commission);
        if (existing.isPresent()) {
            result.commissions().updated++;
        } else {
            result.commissions().created++;
        }
    }
}
