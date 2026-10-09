package org.ceitba.api.web.commission;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.SubjectType;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;

import static org.hamcrest.Matchers.contains;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(CommissionsIT.FixedClock.class)
class CommissionsIT {

    // 2026-09-21 01:00 ART (04:00Z). The UTC date is the same here; the
    // boundary case below uses course_end = today to pin the >= comparison.
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 21);

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-09-21T04:00:00Z"),
                ZoneId.of("America/Argentina/Buenos_Aires"));
        }
    }

    @Autowired MockMvc mvc;
    @Autowired CommissionRepository commissionRepository;
    @Autowired PlanSubjectRepository planSubjectRepository;
    @Autowired SubjectRepository subjectRepository;
    @MockBean ItbaApiClient itbaApiClient;

    @BeforeEach
    void seed() {
        commissionRepository.deleteAll();
        planSubjectRepository.deleteAll();
        subjectRepository.deleteAll();

        subjectRepository.save(new Subject("93.12", "Análisis Matemático I", 6));
        subjectRepository.save(new Subject("72.07", "Protocolos de Comunicación", 6));
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        planSubjectRepository.save(new PlanSubject("72.07", "S10-Rev23", "Ciclo Profesional", 3, 2, 0, List.of()));
        planSubjectRepository.save(new PlanSubject("99.99", "OTHER", "Ciclo Básico", 1, 1, 0, List.of()));

        var a = new Commission("C-93-A", "93.12", "A",
            TODAY.minusMonths(1), TODAY.plusMonths(2), 25, 40, SubjectType.SEMESTRAL);
        a.getTimes().add(new CommissionTime("C-93-A", DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), "101", "SDF", LocalTime.of(11, 0)));
        a.getTimes().add(new CommissionTime("C-93-A", DayOfWeek.MONDAY, LocalTime.of(14, 0), "102", "SDF", LocalTime.of(16, 0)));
        commissionRepository.save(a);

        // Ends today: still current.
        var s = new Commission("C-72-S", "72.07", "S",
            TODAY.minusMonths(4), TODAY, 10, 20, SubjectType.ANNUAL);
        commissionRepository.save(s);

        // Ended yesterday: excluded.
        var old = new Commission("C-93-OLD", "93.12", "Z",
            TODAY.minusMonths(6), TODAY.minusDays(1), 5, 30, SubjectType.SEMESTRAL);
        commissionRepository.save(old);

        // Other plan's subject: excluded.
        var other = new Commission("C-99", "99.99", "A",
            TODAY.minusMonths(1), TODAY.plusMonths(1), 5, 30, SubjectType.SEMESTRAL);
        commissionRepository.save(other);
    }

    @Test
    void anonymousListsCurrentCommissionsOfThePlanFromTheDb() throws Exception {
        mvc.perform(get("/v1/commissions").param("plan", "S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id", contains("C-72-S", "C-93-A")))
            .andExpect(jsonPath("$[0].subjectCode").value("72.07"))
            .andExpect(jsonPath("$[0].subjectName").value("Protocolos de Comunicación"))
            .andExpect(jsonPath("$[0].subjectType").value("ANNUAL"))
            .andExpect(jsonPath("$[0].courseEnd").value("2026-09-21"))
            .andExpect(jsonPath("$[0].times.length()").value(0))
            .andExpect(jsonPath("$[1].commissionName").value("A"))
            .andExpect(jsonPath("$[1].quota").value(40))
            .andExpect(jsonPath("$[1].enrolledStudents").value(25))
            .andExpect(jsonPath("$[1].courseStart").value("2026-08-21"))
            // Times ordered by day then hour.
            .andExpect(jsonPath("$[1].times[0].day").value("MONDAY"))
            .andExpect(jsonPath("$[1].times[0].hourFrom").value("14:00"))
            .andExpect(jsonPath("$[1].times[0].hourTo").value("16:00"))
            .andExpect(jsonPath("$[1].times[0].building").value("SDF"))
            .andExpect(jsonPath("$[1].times[0].classroom").value("102"))
            .andExpect(jsonPath("$[1].times[1].day").value("WEDNESDAY"));

        verifyNoInteractions(itbaApiClient);
    }

    // Same selection as /v1/subjects: when the next term of 93.12 is synced
    // before the running one ends, only the next term is listed.
    @Test
    void nextTermSyncedEarlyReplacesTheRunningTerm() throws Exception {
        var next = new Commission("C-93-NEXT", "93.12", "A",
            TODAY.plusMonths(5), TODAY.plusMonths(9), 0, 40, SubjectType.SEMESTRAL);
        commissionRepository.save(next);

        mvc.perform(get("/v1/commissions").param("plan", "S10-Rev23"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id", contains("C-72-S", "C-93-NEXT")));
    }

    @Test
    void unknownPlanReturns404() throws Exception {
        mvc.perform(get("/v1/commissions").param("plan", "NOPE"))
            .andExpect(status().isNotFound());
    }

    @Test
    void missingPlanParamReturns400() throws Exception {
        mvc.perform(get("/v1/commissions"))
            .andExpect(status().isBadRequest());
    }
}
