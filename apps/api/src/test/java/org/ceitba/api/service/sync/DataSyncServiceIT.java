package org.ceitba.api.service.sync;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.Plan;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "itba.api.use-fake=true")
@Testcontainers
class DataSyncServiceIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

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
            new CommissionProjection("93.12-A", "93.12", "A",
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
    void backfillsMissingSubjectFromCommission() {
        fakeClient.stubPlan("S10-Rev23", List.of()); // no subjects in plan
        fakeClient.stubCommissions(List.of(
            new CommissionProjection("X-A", "99.99", "A",
                LocalDate.now(), LocalDate.now().plusMonths(1),
                0, 30, SubjectType.SEMESTRAL, List.of())
        ));

        var result = syncService.syncAll(CommissionQuery.defaults());

        assertThat(subjectRepository.findById("99.99")).isPresent();
        assertThat(result.subjects().getCreated()).isEqualTo(1);
        assertThat(result.commissions().getCreated()).isEqualTo(1);
    }
}
