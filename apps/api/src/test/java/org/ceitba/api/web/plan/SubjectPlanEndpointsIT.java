package org.ceitba.api.web.plan;

import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.repository.PlanSubjectRepository;
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

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class SubjectPlanEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired PlanSubjectRepository planSubjectRepository;

    @BeforeEach
    void seed() {
        planSubjectRepository.deleteAll();
        // (subjectId, planId, section, year, semester, creditsRequired, deps)
        // creditsRequired is NOT NULL in the schema; service layer normalizes to 0 when "absent".
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        planSubjectRepository.save(new PlanSubject("93.13", "S10-Rev23", "Ciclo Básico", 1, 2, 0, List.of("93.12")));
        planSubjectRepository.save(new PlanSubject("93.99", "S10-Rev23", "Electivas", 0, 0, 120, List.of()));
    }

    @Test
    void noFiltersReturnsAll() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subjects"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3));
    }

    @Test
    void filterByYearReturnsOnlyMatching() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subjects?year=1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void filterByYearAndSemesterReturnsOne() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subjects?year=1&semester=2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].subjectId").value("93.13"))
            .andExpect(jsonPath("$[0].dependencies[0]").value("93.12"));
    }

    @Test
    void electiveTypeReturnsYear0Semester0() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subjects?type=elective"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].subjectId").value("93.99"))
            .andExpect(jsonPath("$[0].creditsRequired").value(120));
    }

    @Test
    void filterBySection() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subjects?section=Electivas"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].section").value("Electivas"));
    }
}
