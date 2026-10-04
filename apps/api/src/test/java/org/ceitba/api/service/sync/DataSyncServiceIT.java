package org.ceitba.api.service.sync;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.PlanSubjectId;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.external.itba.CommissionProjection;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.service.career.CareerService;
import org.ceitba.api.web.career.dto.CreatePlanRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "itba.api.use-fake=true")
class DataSyncServiceIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired DataSyncService syncService;
    @Autowired FakeItbaApiClient fakeClient;
    @Autowired CareerRepository careerRepository;
    @Autowired PlanRepository planRepository;
    @Autowired SubjectRepository subjectRepository;
    @Autowired PlanSubjectRepository planSubjectRepository;
    @Autowired CommissionRepository commissionRepository;
    @Autowired CareerService careerService;

    @BeforeEach
    void seed() {
        commissionRepository.deleteAll();
        planSubjectRepository.deleteAll();
        subjectRepository.deleteAll();
        planRepository.deleteAll();
        careerRepository.deleteAll();
        fakeClient.reset();

        var s = careerRepository.save(new Career("S", "Sistemas"));
        planRepository.save(new Plan("S10-Rev23", s, "Plan 2023"));
    }

    @Test
    void syncAllCreatesSubjectsPlansAndCommissions() {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), 0, "Algoritmos", 6),
            new SubjectPlanProjection("93.13", "S10-Rev23", "Ciclo Básico", 1, 2,
                List.of("93.12"), 0, "Algoritmos II", 6)
        ));
        fakeClient.stubCommissions(List.of(
            new CommissionProjection("93.12-A", "93.12", "Algoritmos", "A",
                LocalDate.of(2025, 7, 21), LocalDate.of(2025, 12, 31),
                10, 30, SubjectType.SEMESTRAL,
                List.of(new CommissionProjection.TimeSlot(
                    DayOfWeek.MONDAY, "102T", "SDT", LocalTime.of(14, 0), LocalTime.of(17, 0))))
        ));

        var result = syncService.syncAll(CommissionQuery.defaults());

        assertThat(result.subjects().getCreated()).isEqualTo(2);
        assertThat(result.subjectPlans().getCreated()).isEqualTo(2);
        assertThat(result.commissions().getCreated()).isEqualTo(1);
        assertThat(subjectRepository.count()).isEqualTo(2);
        assertThat(planSubjectRepository.count()).isEqualTo(2);
        assertThat(commissionRepository.count()).isEqualTo(1);
        // Times collection is lazy — check it via the commission_time table directly
        // would require a separate repo. Counting the parent commission is enough
        // to prove the upsert wrote, and the FK constraint guarantees referential integrity.
    }

    @Test
    void rerunIsIdempotent_noNewCreates() {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), 0, "Algoritmos", 6)));
        fakeClient.stubCommissions(List.of());
        syncService.syncAll(CommissionQuery.defaults());

        var second = syncService.syncAll(CommissionQuery.defaults());

        assertThat(second.subjects().getCreated()).isZero();
        assertThat(second.subjectPlans().getCreated()).isZero();
        assertThat(second.subjects().getUpdated()).isZero();
    }

    @Test
    void detectsSubjectChange_marksUpdated() {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), 0, "Algoritmos", 6)));
        fakeClient.stubCommissions(List.of());
        syncService.syncAll(CommissionQuery.defaults());

        // Same code, different name+credits → update
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), 0, "Algoritmos (Rev)", 7)));

        var second = syncService.syncAll(CommissionQuery.defaults());

        assertThat(second.subjects().getUpdated()).isEqualTo(1);
        var s = subjectRepository.findById("93.12").orElseThrow();
        assertThat(s.getName()).isEqualTo("Algoritmos (Rev)");
        assertThat(s.getCredits()).isEqualTo(7);
    }

    @Test
    void backfillsMissingSubjectFromCommission_usesNameWhenAvailable() {
        fakeClient.stubPlan("S10-Rev23", List.of()); // no subjects in plan
        fakeClient.stubCommissions(List.of(
            new CommissionProjection("X-A", "99.99", "Some Real Name", "A",
                LocalDate.now(), LocalDate.now().plusMonths(1),
                0, 30, SubjectType.SEMESTRAL, List.of())
        ));

        var result = syncService.syncAll(CommissionQuery.defaults());

        var subject = subjectRepository.findById("99.99").orElseThrow();
        assertThat(subject.getName()).isEqualTo("Some Real Name");
        assertThat(result.subjects().getCreated()).isEqualTo(1);
        assertThat(result.commissions().getCreated()).isEqualTo(1);
    }

    @Test
    void backfillsMissingSubject_fallsBackToCodeWhenNameAbsent() {
        fakeClient.stubPlan("S10-Rev23", List.of());
        fakeClient.stubCommissions(List.of(
            // null subjectName — older payloads or sparse responses
            new CommissionProjection("X-A", "99.99", null, "A",
                LocalDate.now(), LocalDate.now().plusMonths(1),
                0, 30, SubjectType.SEMESTRAL, List.of())
        ));

        syncService.syncAll(CommissionQuery.defaults());

        // Falls back to the code as the name (matches NestJS behavior)
        assertThat(subjectRepository.findById("99.99").orElseThrow().getName())
            .isEqualTo("99.99");
    }

    @Test
    void planAddedByStaffIsPickedUpByTheNextSync() {
        // The gateway cannot list plans (docs/ITBA-GATEWAY.md): a new yearly
        // entrance plan is registered through CareerService.addPlan and the
        // regular plan walk then pulls its subjects.
        careerRepository.save(new Career("ENT", "Programa de ingreso"));
        careerService.addPlan("ENT", new CreatePlanRequest("ENT-2027", null));
        fakeClient.stubPlan("ENT-2027", List.of(
            new SubjectPlanProjection("10.01", "ENT-2027", "Ingreso", 1, 1,
                List.of(), 0, "Matemática de ingreso", 3)));

        var result = syncService.syncSubjectsAndPlansOnly();

        assertThat(result.subjectPlans().getErrors()).isZero();
        assertThat(result.subjectPlans().getCreated()).isEqualTo(1);
        assertThat(planSubjectRepository.findById(new PlanSubjectId("10.01", "ENT-2027")))
            .isPresent();
    }

    @Test
    void resyncUpdatesExistingCommission() {
        fakeClient.stubPlan("S10-Rev23", List.of());
        fakeClient.stubCommissions(List.of(commission(10, 30, List.of(
            new CommissionProjection.TimeSlot(
                DayOfWeek.MONDAY, "102T", "SDT", LocalTime.of(14, 0), LocalTime.of(17, 0)),
            new CommissionProjection.TimeSlot(
                DayOfWeek.WEDNESDAY, "201F", "SDF", LocalTime.of(9, 0), LocalTime.of(11, 0))))));
        syncService.syncAll(CommissionQuery.defaults());

        // Same id: enrolled/quota changed, Monday slot moved room and end
        // hour, Wednesday slot dropped, Friday slot added.
        fakeClient.stubCommissions(List.of(commission(25, 40, List.of(
            new CommissionProjection.TimeSlot(
                DayOfWeek.MONDAY, "103T", "SDT", LocalTime.of(14, 0), LocalTime.of(18, 0)),
            new CommissionProjection.TimeSlot(
                DayOfWeek.FRIDAY, "301F", "SDF", LocalTime.of(10, 0), LocalTime.of(12, 0))))));
        var second = syncService.syncCommissionsOnly(CommissionQuery.defaults());

        assertThat(second.commissions().getErrors()).isZero();
        assertThat(second.commissions().getUpdated()).isEqualTo(1);
        var c = commissionRepository.findById("93.12-A").orElseThrow();
        assertThat(c.getEnrolledStudents()).isEqualTo(25);
        assertThat(c.getQuota()).isEqualTo(40);
        assertThat(times("93.12-A")).containsExactly(
            "MONDAY 14:00-18:00 103T", "FRIDAY 10:00-12:00 301F");
    }

    @Test
    void syncCommissionsBySubjectUpdatesExistingCommission() {
        fakeClient.stubPlan("S10-Rev23", List.of());
        fakeClient.stubCommissions(List.of(commission(10, 30, List.of(
            new CommissionProjection.TimeSlot(
                DayOfWeek.MONDAY, "102T", "SDT", LocalTime.of(14, 0), LocalTime.of(17, 0))))));
        syncService.syncAll(CommissionQuery.defaults());

        fakeClient.stubCommissions(List.of(commission(12, 35, List.of(
            new CommissionProjection.TimeSlot(
                DayOfWeek.TUESDAY, "102T", "SDT", LocalTime.of(8, 0), LocalTime.of(10, 0))))));
        syncService.syncCommissionsBySubject("93.12", CommissionQuery.defaults());

        var c = commissionRepository.findById("93.12-A").orElseThrow();
        assertThat(c.getEnrolledStudents()).isEqualTo(12);
        assertThat(c.getQuota()).isEqualTo(35);
        assertThat(times("93.12-A")).containsExactly("TUESDAY 08:00-10:00 102T");
    }

    private static CommissionProjection commission(int enrolled, int quota,
                                                   List<CommissionProjection.TimeSlot> times) {
        return new CommissionProjection("93.12-A", "93.12", "Algoritmos", "A",
            LocalDate.of(2025, 7, 21), LocalDate.of(2025, 12, 31),
            enrolled, quota, SubjectType.SEMESTRAL, times);
    }

    // findAllWithTimes hydrates the lazy collection, ordered by day then hour.
    private List<String> times(String commissionId) {
        return commissionRepository.findAllWithTimes().stream()
            .filter(c -> c.getId().equals(commissionId))
            .flatMap(c -> c.getTimes().stream())
            .map(t -> t.getDay() + " " + t.getHourFrom() + "-" + t.getHourTo() + " " + t.getClassroom())
            .toList();
    }
}
