package org.ceitba.api.web.career;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
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
class CareerWritesIT {

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

    @BeforeEach
    void seed() {
        planRepository.deleteAll();
        careerRepository.deleteAll();
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

    @Test
    void anonymousCannotCreate() throws Exception {
        mvc.perform(post("/v1/careers")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S\",\"name\":\"Sistemas\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotCreate() throws Exception {
        mvc.perform(post("/v1/careers").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S\",\"name\":\"Sistemas\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void staffCanCreate_returns201() throws Exception {
        mvc.perform(post("/v1/careers").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S\",\"name\":\"Sistemas\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("S"))
            .andExpect(jsonPath("$.name").value("Sistemas"))
            .andExpect(jsonPath("$.plans.length()").value(0));
    }

    @Test
    void duplicateIdReturns409() throws Exception {
        careerRepository.save(new Career("S", "Sistemas"));
        mvc.perform(post("/v1/careers").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S\",\"name\":\"Sistemas v2\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void missingNameReturns400() throws Exception {
        mvc.perform(post("/v1/careers").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S\",\"name\":\"\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void putUpdatesNameOnly() throws Exception {
        careerRepository.save(new Career("S", "Sistemas"));
        mvc.perform(put("/v1/careers/S").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Sistemas (Reformado)\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("S"))
            .andExpect(jsonPath("$.name").value("Sistemas (Reformado)"));
    }

    @Test
    void putUnknownIdReturns404() throws Exception {
        mvc.perform(put("/v1/careers/NOPE").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"x\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }

    @Test
    void deleteReturns204AndRemoves() throws Exception {
        careerRepository.save(new Career("X", "Removable"));
        mvc.perform(delete("/v1/careers/X").with(staff()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/v1/careers/X")).andExpect(status().isNotFound());
    }

    @Test
    void deleteUnknownReturns404() throws Exception {
        mvc.perform(delete("/v1/careers/NOPE").with(staff()))
            .andExpect(status().isNotFound());
    }

    @Test
    void deleteCareerWithPlansReturns409() throws Exception {
        // FK from plan.career_id is RESTRICT; deleting a career with plans
        // hits DataIntegrityViolation -> 409 via the global handler.
        var s = careerRepository.save(new Career("S", "Sistemas"));
        planRepository.save(new Plan("S10-Rev23", s, "Plan 2023"));

        mvc.perform(delete("/v1/careers/S").with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DataIntegrityViolation"));
    }

    @Test
    void regularUserCannotDelete() throws Exception {
        careerRepository.save(new Career("X", "x"));
        mvc.perform(delete("/v1/careers/X").with(user()))
            .andExpect(status().isForbidden());
    }

    @Test
    void staffCanAddPlanToCareer() throws Exception {
        careerRepository.save(new Career("PAI", "Proceso de Admisión"));
        mvc.perform(post("/v1/careers/PAI/plans").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\" PX27 Proceso I \"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("PX27 Proceso I"))
            .andExpect(jsonPath("$.careerId").value("PAI"))
            .andExpect(jsonPath("$.name").value("PX27 Proceso I"));

        mvc.perform(get("/v1/careers/plans"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.PAI.plans[0]").value("PX27 Proceso I"));
    }

    @Test
    void addPlanKeepsExplicitName() throws Exception {
        careerRepository.save(new Career("S", "Sistemas"));
        mvc.perform(post("/v1/careers/S/plans").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S30\",\"name\":\"Plan 2030\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Plan 2030"));
    }

    @Test
    void addPlanWithIdUsedByAnyCareerReturns409() throws Exception {
        var s = careerRepository.save(new Career("S", "Sistemas"));
        careerRepository.save(new Career("I", "Industrial"));
        planRepository.save(new Plan("S10-Rev23", s, "Plan 2023"));

        mvc.perform(post("/v1/careers/I/plans").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S10-Rev23\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void addPlanToUnknownCareerReturns404() throws Exception {
        mvc.perform(post("/v1/careers/NOPE/plans").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"X1\"}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void addPlanValidatesId() throws Exception {
        careerRepository.save(new Career("S", "Sistemas"));
        mvc.perform(post("/v1/careers/S/plans").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"" + "x".repeat(26) + "\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void regularUserCannotAddPlan() throws Exception {
        careerRepository.save(new Career("S", "Sistemas"));
        mvc.perform(post("/v1/careers/S/plans").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S30\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(post("/v1/careers/S/plans")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"S30\"}"))
            .andExpect(status().isUnauthorized());
    }
}
