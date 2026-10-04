package org.ceitba.api.web.plan;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class SubjectPlanWritesIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired CareerRepository careerRepository;
    @Autowired PlanRepository planRepository;
    @Autowired SubjectRepository subjectRepository;
    @Autowired PlanSubjectRepository planSubjectRepository;

    @BeforeEach
    void seed() {
        planSubjectRepository.deleteAll();
        subjectRepository.deleteAll();
        planRepository.deleteAll();
        careerRepository.deleteAll();

        var s = careerRepository.save(new Career("S", "Sistemas"));
        planRepository.save(new Plan("S10-Rev23", s, "Plan 2023"));
        planRepository.save(new Plan("S10-Rev18", s, "Plan 2018"));
        subjectRepository.save(new Subject("93.12", "Algoritmos", 6));
        subjectRepository.save(new Subject("93.13", "Algoritmos II", 6));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "regular@itba.edu.ar")).authorities(
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar")).authorities(
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"),
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_STAFF"));
    }

    // ----- read endpoints (public) -----

    @Test
    void getOneReturnsTheRow() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        mvc.perform(get("/v1/plans/S10-Rev23/subject/93.12"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.subjectId").value("93.12"))
            .andExpect(jsonPath("$.planId").value("S10-Rev23"))
            // Subject inline shape is enriched from Subject repo
            .andExpect(jsonPath("$.subject.name").value("Algoritmos"))
            .andExpect(jsonPath("$.subject.credits").value(6));
    }

    @Test
    void getOneUnknownReturns404() throws Exception {
        mvc.perform(get("/v1/plans/S10-Rev23/subject/93.12"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }

    @Test
    void getPlansForSubjectReturnsAllContainingPlans() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev18", "Ciclo Básico", 1, 2, 0, List.of()));
        mvc.perform(get("/v1/plans/subjects/93.12/plans"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void getPlansForUnknownSubjectReturnsEmptyList() throws Exception {
        mvc.perform(get("/v1/plans/subjects/99.99/plans"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));
    }

    // ----- write endpoints (STAFF) -----

    @Test
    void anonymousCannotCreate() throws Exception {
        mvc.perform(post("/v1/plans/S10-Rev23/subject")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"93.12\",\"section\":\"Ciclo Básico\",\"year\":1,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/plans/S10-Rev23/subject").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"93.12\",\"section\":\"Ciclo Básico\",\"year\":1,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void staffCanCreate_returns201() throws Exception {
        mvc.perform(post("/v1/plans/S10-Rev23/subject").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"93.12\",\"section\":\"Ciclo Básico\",\"year\":1,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.subjectId").value("93.12"))
            .andExpect(jsonPath("$.planId").value("S10-Rev23"))
            .andExpect(jsonPath("$.year").value(1))
            .andExpect(jsonPath("$.subject.name").value("Algoritmos"));
    }

    @Test
    void createWithUnknownPlanReturns404() throws Exception {
        mvc.perform(post("/v1/plans/NOPE/subject").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"93.12\",\"section\":\"x\",\"year\":1,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Plan")));
    }

    @Test
    void createWithUnknownSubjectReturns404() throws Exception {
        mvc.perform(post("/v1/plans/S10-Rev23/subject").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"99.99\",\"section\":\"x\",\"year\":1,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Subject")));
    }

    @Test
    void createDuplicateReturns409() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        mvc.perform(post("/v1/plans/S10-Rev23/subject").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":\"93.12\",\"section\":\"Other\",\"year\":2,\"semester\":1,\"creditsRequired\":0,\"dependencies\":[]}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void createWithMissingFieldsReturns400() throws Exception {
        mvc.perform(post("/v1/plans/S10-Rev23/subject").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"section\":\"x\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void putUpdatesOnlyProvidedFields() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of("93.11")));
        mvc.perform(put("/v1/plans/S10-Rev23/subject/93.12").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"year\":2,\"semester\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.year").value(2))
            .andExpect(jsonPath("$.semester").value(2))
            // section + dependencies preserved
            .andExpect(jsonPath("$.section").value("Ciclo Básico"))
            .andExpect(jsonPath("$.dependencies[0]").value("93.11"));
    }

    @Test
    void putUnknownReturns404() throws Exception {
        mvc.perform(put("/v1/plans/S10-Rev23/subject/93.12").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"year\":2}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void deleteReturns204() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        mvc.perform(delete("/v1/plans/S10-Rev23/subject/93.12").with(staff()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/plans/S10-Rev23/subject/93.12"))
            .andExpect(status().isNotFound());
    }

    @Test
    void deleteUnknownReturns404() throws Exception {
        mvc.perform(delete("/v1/plans/S10-Rev23/subject/93.12").with(staff()))
            .andExpect(status().isNotFound());
    }

    @Test
    void regularUserCannotDelete() throws Exception {
        planSubjectRepository.save(new PlanSubject("93.12", "S10-Rev23", "Ciclo Básico", 1, 1, 0, List.of()));
        mvc.perform(delete("/v1/plans/S10-Rev23/subject/93.12").with(user()))
            .andExpect(status().isForbidden());
    }
}
