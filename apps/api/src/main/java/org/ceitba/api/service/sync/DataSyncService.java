package org.ceitba.api.service.sync;

import org.ceitba.api.domain.Subject;
import org.ceitba.api.external.itba.CommissionProjection;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.List;

// Pulls the latest snapshot from the ITBA API and upserts subjects,
// plan-subjects, and commissions into the local DB. One transaction per
// plan / commission (see SyncUpserter) — a bad row in plan A doesn't roll
// back plan B.
@Service
public class DataSyncService {

    private static final Logger log = LoggerFactory.getLogger(DataSyncService.class);

    private final ItbaApiClient itbaApiClient;
    private final CareerRepository careerRepository;
    private final PlanRepository planRepository;
    private final SubjectRepository subjectRepository;
    private final SyncUpserter upserter;
    private final Clock clock;

    public DataSyncService(ItbaApiClient itbaApiClient,
                           CareerRepository careerRepository,
                           PlanRepository planRepository,
                           SubjectRepository subjectRepository,
                           SyncUpserter upserter,
                           Clock clock) {
        this.itbaApiClient = itbaApiClient;
        this.careerRepository = careerRepository;
        this.planRepository = planRepository;
        this.subjectRepository = subjectRepository;
        this.upserter = upserter;
        this.clock = clock;
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
        upserter.upsertPlanEntries(planId, entries, result);
        return entries;
    }

    public List<CommissionProjection> syncCommissionsBySubject(String subjectCode, CommissionQuery query) {
        var q = (query != null ? query : CommissionQuery.defaults()).withDefaultsFilled(clock);
        var commissions = itbaApiClient.getCommissionsBySubject(subjectCode, q);
        var result = new DataSyncResult();
        for (var c : commissions) {
            upsertCommission(c, q, result);
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
                    upserter.upsertPlanEntries(plan.getId(), entries, result);
                } catch (Exception e) {
                    log.error("Failed to sync plan {} (career {})", plan.getId(), career.getId(), e);
                    result.subjectPlans().errors++;
                }
            }
        }
    }

    private void syncCommissions(DataSyncResult result, CommissionQuery query) {
        var q = query.withDefaultsFilled(clock);
        log.info("Syncing commissions year={} period={} levels={}", q.year(), q.period(), q.levels());

        List<CommissionProjection> commissions;
        try {
            commissions = itbaApiClient.getCommissions(q);
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
                upsertCommission(c, q, result);
            } catch (Exception e) {
                log.error("Failed to upsert commission {}", c.id(), e);
                result.commissions().errors++;
            }
        }
    }

    // `term` must be the filled query (see CommissionQuery.withDefaultsFilled):
    // its year and period are stamped on the row.
    private void upsertCommission(CommissionProjection projection, CommissionQuery term, DataSyncResult result) {
        if (upserter.upsertCommission(projection, term)) {
            result.commissions().created++;
        } else {
            result.commissions().updated++;
        }
    }
}
