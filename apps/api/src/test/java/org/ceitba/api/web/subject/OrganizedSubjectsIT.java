package org.ceitba.api.web.subject;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.SubjectPlanProjection;
import org.ceitba.api.repository.CommissionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "itba.api.use-fake=true")
@AutoConfigureMockMvc
@Testcontainers
@Import({OrganizedSubjectsIT.FixedClock.class, OrganizedSubjectsIT.TxRecordingClient.class})
class OrganizedSubjectsIT {

    // 2026-10-02 in ART: second semester 2026 is running, first semester
    // (2026-03-01 .. 2026-07-25) has ended.
    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-10-02T15:00:00Z"),
                ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    // Fake ITBA client that records whether a DB transaction was active while
    // the (in prod, slow) external call ran. A subclass rather than a Mockito
    // spy: inline mocking of concrete classes breaks on newer host JDKs.
    @TestConfiguration
    static class TxRecordingClient {
        @Bean
        @Primary
        RecordingFakeItbaApiClient recordingFakeItbaApiClient() {
            return new RecordingFakeItbaApiClient();
        }
    }

    static class RecordingFakeItbaApiClient extends FakeItbaApiClient {
        volatile Boolean txActiveDuringLastPlanCall;

        @Override
        public List<SubjectPlanProjection> getSubjectsByPlan(String planId) {
            txActiveDuringLastPlanCall = TransactionSynchronizationManager.isActualTransactionActive();
            return super.getSubjectsByPlan(planId);
        }
    }

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired RecordingFakeItbaApiClient fakeClient;
    @Autowired CommissionRepository commissionRepository;

    @BeforeEach
    void seed() {
        fakeClient.reset();
        commissionRepository.deleteAll();
    }

    @Test
    void getSubjectsByPlanReturnsOrganizedNestedMap() throws Exception {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), null, "Algoritmos", 6),
            new SubjectPlanProjection("93.13", "S10-Rev23", "Ciclo Básico", 1, 2,
                List.of("93.12"), null, "Algoritmos II", 6),
            new SubjectPlanProjection("93.99", "S10-Rev23", "Electivas", null, null,
                List.of(), 120, "Tópicos Avanzados", 4)
        ));

        var commission = new Commission("93.12-A", "93.12", "A",
            LocalDate.of(2025, 7, 21), LocalDate.of(2025, 12, 31),
            10, 30, SubjectType.SEMESTRAL);
        commission.getTimes().add(new CommissionTime(
            "93.12-A", DayOfWeek.MONDAY, LocalTime.of(14, 0), "102T", "SDT", LocalTime.of(17, 0)));
        commissionRepository.save(commission);

        mvc.perform(get("/v1/subjects?plan=S10-Rev23"))
            .andExpect(status().isOk())
            // sectioned → year → semester → list
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].subject_id").value("93.12"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].name").value("Algoritmos"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].credits").value(6))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[0].name").value("A"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0].day").value("MONDAY"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0].time_from").value("14:00:00"))
            // dependencies populated
            .andExpect(jsonPath("$['Ciclo Básico']['1']['2'][0].dependencies[0]").value("93.12"))
            // null year/semester → "0" key (electives)
            .andExpect(jsonPath("$['Electivas']['0']['0'][0].subject_id").value("93.99"))
            .andExpect(jsonPath("$['Electivas']['0']['0'][0].credits_required").value(120));
    }

    // Regression: prod listed 31.08's commissions twice (G, B, G, B, ...)
    // because the commission table keeps every synced term and the endpoint
    // read all of them. Only the running term must be returned.
    @Test
    void pastTermCommissionsAreNotListedAlongsideTheCurrentTerm() throws Exception {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("31.08", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), null, "Sistemas de Representación", 3)
        ));
        // First semester 2026 (ended) and second semester 2026 (running): same
        // commission names and schedules, different ITBA ids.
        saveCommission("44001", "31.08", "G", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 25), "102T");
        saveCommission("44002", "31.08", "B", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 25), "101T");
        saveCommission("45120", "31.08", "G", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 31), "102T");
        saveCommission("45114", "31.08", "B", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 31), "101T");

        mvc.perform(get("/v1/subjects?plan=S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions", hasSize(2)))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[*].name", contains("B", "G")))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].course_start").value("2026-07-26"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].course_end").value("2026-12-31"));
    }

    // Two offerings that are both still running (e.g. consecutive bimesters)
    // are distinct and both kept; a subject with only ended terms shows its
    // most recent term instead of going empty between terms.
    @Test
    void keepsConcurrentTermsAndFallsBackToMostRecentEndedTerm() throws Exception {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("81.74", "S10-Rev23", "Electivas", null, null,
                List.of(), null, "Electiva bimestral", 3),
            new SubjectPlanProjection("72.99", "S10-Rev23", "Electivas", null, null,
                List.of(), null, "Electiva de primer cuatrimestre", 3)
        ));
        saveCommission("46512", "81.74", "A", LocalDate.of(2026, 9, 14), LocalDate.of(2026, 10, 23), "301F");
        saveCommission("47536", "81.74", "A", LocalDate.of(2026, 10, 26), LocalDate.of(2026, 11, 30), "302F");
        saveCommission("40001", "72.99", "A", LocalDate.of(2025, 3, 1), LocalDate.of(2025, 7, 25), "101T");
        saveCommission("44100", "72.99", "A", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 25), "102T");

        mvc.perform(get("/v1/subjects?plan=S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$['Electivas']['0']['0'][0].subject_id").value("81.74"))
            .andExpect(jsonPath("$['Electivas']['0']['0'][0].commissions", hasSize(2)))
            .andExpect(jsonPath("$['Electivas']['0']['0'][0].course_start").value("2026-09-14"))
            .andExpect(jsonPath("$['Electivas']['0']['0'][1].subject_id").value("72.99"))
            .andExpect(jsonPath("$['Electivas']['0']['0'][1].commissions", hasSize(1)))
            .andExpect(jsonPath("$['Electivas']['0']['0'][1].commissions[0].schedule[0].classroom").value("102T"))
            .andExpect(jsonPath("$['Electivas']['0']['0'][1].course_start").value("2026-03-01"));
    }

    // The next term is synced before the running one ends: both are "not
    // ended", and only the upcoming term (the one students plan) is listed.
    @Test
    void nextTermSyncedBeforeTheRunningOneEndsReplacesIt() throws Exception {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("31.08", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), null, "Sistemas de Representación", 3)
        ));
        saveCommission("45120", "31.08", "G", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15), "102T");
        saveCommission("45114", "31.08", "B", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15), "101T");
        saveCommission("48120", "31.08", "G", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 7, 10), "202T");
        saveCommission("48114", "31.08", "B", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 7, 10), "201T");

        mvc.perform(get("/v1/subjects?plan=S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].commissions[*].commission_id",
                contains("48114", "48120")))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].course_start").value("2027-03-08"))
            .andExpect(jsonPath("$['Ciclo Básico']['1']['1'][0].course_end").value("2027-07-10"));
    }

    // The ITBA call can take up to 30 s; it must not run inside a DB
    // transaction (which would pin a pooled connection for its duration).
    @Test
    void externalItbaCallRunsOutsideAnyTransaction() throws Exception {
        fakeClient.stubPlan("S10-Rev23", List.of(
            new SubjectPlanProjection("93.12", "S10-Rev23", "Ciclo Básico", 1, 1,
                List.of(), null, "Algoritmos", 6)
        ));
        fakeClient.txActiveDuringLastPlanCall = null;

        mvc.perform(get("/v1/subjects?plan=S10-Rev23")).andExpect(status().isOk());

        assertThat(fakeClient.txActiveDuringLastPlanCall).isFalse();
    }

    private void saveCommission(String id, String subjectCode, String name,
                                LocalDate start, LocalDate end, String classroom) {
        var c = new Commission(id, subjectCode, name, start, end, 0, 0, SubjectType.SEMESTRAL);
        c.getTimes().add(new CommissionTime(
            id, DayOfWeek.TUESDAY, LocalTime.of(8, 0), classroom, "SDT", LocalTime.of(11, 0)));
        commissionRepository.save(c);
    }

    @Test
    void unknownPlanReturns404() throws Exception {
        mvc.perform(get("/v1/subjects?plan=NOPE"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }
}
