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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "itba.api.use-fake=true")
@AutoConfigureMockMvc
@Testcontainers
class OrganizedSubjectsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired FakeItbaApiClient fakeClient;
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

    @Test
    void unknownPlanReturns404() throws Exception {
        mvc.perform(get("/v1/subjects?plan=NOPE"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }
}
