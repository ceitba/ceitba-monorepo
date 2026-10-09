package org.ceitba.api.service.sync;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.PlanSubjectId;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.external.itba.CommissionProjection;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.service.correction.CorrectionSlots;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;

// The per-plan / per-commission writes of DataSyncService. A separate bean so
// the REQUIRES_NEW boundaries go through the Spring proxy: called on `this`
// from DataSyncService they ran with no transaction at all, so an existing
// commission came back detached and touching its lazy `times` threw.
@Component
class SyncUpserter {

    private static final Logger log = LoggerFactory.getLogger(SyncUpserter.class);
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final SubjectRepository subjectRepository;
    private final PlanSubjectRepository planSubjectRepository;
    private final CommissionRepository commissionRepository;
    private final ScheduleCorrectionService scheduleCorrections;

    SyncUpserter(SubjectRepository subjectRepository,
                 PlanSubjectRepository planSubjectRepository,
                 CommissionRepository commissionRepository,
                 ScheduleCorrectionService scheduleCorrections) {
        this.subjectRepository = subjectRepository;
        this.planSubjectRepository = planSubjectRepository;
        this.commissionRepository = commissionRepository;
        this.scheduleCorrections = scheduleCorrections;
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

    // Returns true when the commission was created, false when updated. The
    // caller counts it only after this transaction has committed.
    //
    // `term` is the filled query the commission came from (year and period
    // set); it is stamped on the row, so the last term ITBA listed it in is
    // known. Name, dates and type are refreshed too: they used to be frozen at
    // first insert, so an ITBA date fix never reached the term filter
    // (CommissionTerms). ITBA issues new ids every term, so refreshing in
    // place never overwrites an older term's row; a change is logged anyway.
    //
    // An existing commission is locked (SELECT ... FOR UPDATE) like every
    // schedule-correction write does, so a slot change and its correction
    // expiry can't interleave with a vote on the same commission.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean upsertCommission(CommissionProjection projection, CommissionQuery term) {
        Optional<Commission> existing = commissionRepository.findForUpdate(projection.id());
        var commission = existing.orElseGet(() -> new Commission(
            projection.id(), projection.subjectCode(), projection.commissionName(),
            projection.courseStart(), projection.courseEnd(),
            projection.enrolledStudents(), projection.quota(), projection.subjectType()));

        if (existing.isPresent() && (!commission.getCommissionName().equals(projection.commissionName())
                || !commission.getCourseStart().equals(projection.courseStart())
                || !commission.getCourseEnd().equals(projection.courseEnd())
                || commission.getSubjectType() != projection.subjectType())) {
            log.info("Commission {} ({}) changed upstream: {} {}..{} {} -> {} {}..{} {}",
                projection.id(), projection.subjectCode(),
                commission.getCommissionName(), commission.getCourseStart(), commission.getCourseEnd(),
                commission.getSubjectType(),
                projection.commissionName(), projection.courseStart(), projection.courseEnd(),
                projection.subjectType());
        }

        // Refresh mutable fields
        commission.setCommissionName(projection.commissionName());
        commission.setCourseStart(projection.courseStart());
        commission.setCourseEnd(projection.courseEnd());
        commission.setSubjectType(projection.subjectType());
        commission.setEnrolledStudents(projection.enrolledStudents());
        commission.setQuota(projection.quota());
        commission.setTerm(term.year(), term.period());

        var newSlots = projection.times().stream()
            .map(t -> new CorrectionSlot(t.day().name(), t.hourFrom().format(HH_MM), t.hourTo().format(HH_MM)))
            .sorted(CorrectionSlot.ORDER)
            .toList();
        boolean slotsChanged = existing.isPresent()
            && !CorrectionSlots.sameSet(CorrectionSlots.fromTimes(commission.getTimes()), newSlots);

        if (existing.isPresent()) {
            // Delete the old slots before inserting the new ones: Hibernate
            // runs orphan deletes after inserts within one flush, so a slot
            // whose (course_id, day, hour_from) key survives would collide.
            commission.getTimes().clear();
            commissionRepository.flush();
        }
        for (var slot : projection.times()) {
            commission.getTimes().add(new CommissionTime(
                projection.id(), slot.day(), slot.hourFrom(),
                slot.classroom(), slot.building(), slot.hourTo()));
        }

        commissionRepository.save(commission);
        if (slotsChanged) {
            // Student corrections were made against the old SGA slots.
            scheduleCorrections.onSgaSlotsChanged(projection.id(), newSlots);
        }
        return existing.isEmpty();
    }
}
