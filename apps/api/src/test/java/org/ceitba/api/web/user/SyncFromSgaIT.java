package org.ceitba.api.web.user;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.StudentProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/me/profile/sync-from-sga against FakeItbaApiClient.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "auth.allowed-emails=reviewer@gmail.com",
    "itba.api.use-fake=true"
})
class SyncFromSgaIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String EMAIL = "student@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired FakeItbaApiClient itba;
    @Autowired UserRepository userRepo;
    @Autowired CareerRepository careerRepo;
    @Autowired PlanRepository planRepo;

    @BeforeEach
    void seed() {
        itba.reset();
        userRepo.deleteAll();
        planRepo.deleteAll();
        careerRepo.deleteAll();
        var s = careerRepo.save(new Career("S", "Ingeniería en Informática"));
        var i = careerRepo.save(new Career("I", "Ingeniería Industrial"));
        planRepo.save(new Plan("S10-Rev23", s, "S10-Rev23"));
        planRepo.save(new Plan("I22", i, "I22"));
    }

    @AfterEach
    void resetFake() {
        itba.reset();
    }

    private static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", "Someone"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(post("/v1/me/profile/sync-from-sga")).andExpect(status().isUnauthorized());
    }

    @Test
    void fillsEmptyProfileFromSga() throws Exception {
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Ingeniería en Informática", "S10-Rev23"));

        mvc.perform(post("/v1/me/profile/sync-from-sga").with(as(EMAIL)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(61234))
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10-Rev23"));

        var u = userRepo.findByEmail(EMAIL).orElseThrow();
        assertThat(u.getFileNumber()).isEqualTo(61234);
        assertThat(u.getPlan()).isEqualTo("S10-Rev23");
    }

    @Test
    void doesNotOverwriteExistingValues() throws Exception {
        var u = new User(UUID.randomUUID(), EMAIL, "Student");
        u.setFileNumber(50000);
        u.setCareer(careerRepo.findById("I").orElseThrow());
        u.setPlan("I22");
        userRepo.save(u);
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Ingeniería en Informática", "S10-Rev23"));

        mvc.perform(post("/v1/me/profile/sync-from-sga").with(as(EMAIL)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(50000))
            .andExpect(jsonPath("$.careerId").value("I"))
            .andExpect(jsonPath("$.plan").value("I22"));
    }

    @Test
    void unknownStudentReturnsProfileUnchanged() throws Exception {
        mvc.perform(post("/v1/me/profile/sync-from-sga").with(as(EMAIL)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").doesNotExist())
            .andExpect(jsonPath("$.fileNumber").doesNotExist());
    }

    @Test
    void nonInstitutionalEmailIsNotLookedUp() throws Exception {
        itba.failStudentLookups(true);
        mvc.perform(post("/v1/me/profile/sync-from-sga").with(as("reviewer@gmail.com")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").doesNotExist());
    }

    @Test
    void gatewayFailureIs502AndLeavesProfileAlone() throws Exception {
        itba.failStudentLookups(true);
        mvc.perform(post("/v1/me/profile/sync-from-sga").with(as(EMAIL)))
            .andExpect(status().isBadGateway())
            .andExpect(jsonPath("$.error").value("ExternalApiError"));
        assertThat(userRepo.findByEmail(EMAIL).orElseThrow().getCareer()).isNull();
    }

    @Test
    void responseNeverContainsTheDni() throws Exception {
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Ingeniería en Informática", "S10-Rev23"));
        var body = mvc.perform(post("/v1/me/profile/sync-from-sga").with(as(EMAIL)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContainIgnoringCase("dni").doesNotContain("fake-" + EMAIL);
    }
}
