package org.ceitba.api.web.user;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "itba.api.use-fake=true"})
class MeProfileIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String EMAIL = "alice@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired CareerRepository careerRepo;
    @Autowired PlanRepository planRepo;
    @Autowired PlatformTransactionManager txManager;
    @Autowired DataSource dataSource;

    @BeforeEach
    void seed() {
        userRepo.deleteAll();
        planRepo.deleteAll();
        careerRepo.deleteAll();
        var s = careerRepo.save(new Career("S", "Ingeniería en Informática"));
        var i = careerRepo.save(new Career("I", "Ingeniería Industrial"));
        planRepo.save(new Plan("S10-Rev23", s, "S10-Rev23"));
        planRepo.save(new Plan("S10 - Rev18", s, "S10 - Rev18"));
        planRepo.save(new Plan("I22", i, "I22"));
        userRepo.save(new User(UUID.randomUUID(), EMAIL, "Alice"));
    }

    private static RequestPostProcessor alice() {
        return jwt().jwt(t -> t.claim("email", EMAIL).claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private org.springframework.test.web.servlet.ResultActions patchProfile(String json) throws Exception {
        return mvc.perform(patch("/v1/me/profile").with(alice())
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private User reload() {
        return userRepo.findByEmail(EMAIL).orElseThrow();
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(get("/v1/me/profile")).andExpect(status().isUnauthorized());
        mvc.perform(patch("/v1/me/profile").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void setsCareerAndMatchingPlan() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"S10-Rev23\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10-Rev23"))
            .andExpect(jsonPath("$.fileNumber").doesNotExist());

        mvc.perform(get("/v1/me/profile").with(alice()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10-Rev23"));
    }

    @Test
    void rejectsPlanOfAnotherCareer() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"I22\"}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
        // Nothing was persisted.
        assertThat(reload().getCareer()).isNull();
        assertThat(reload().getPlan()).isNull();
    }

    @Test
    void rejectsUnknownPlanAndPlanWithoutCareer() throws Exception {
        patchProfile("{\"plan\":\"S10-Rev23\"}")
            .andExpect(status().isBadRequest());
        patchProfile("{\"careerId\":\"S\",\"plan\":\"NOPE\"}")
            .andExpect(status().isBadRequest());
    }

    @Test
    void unknownCareerIs404() throws Exception {
        patchProfile("{\"careerId\":\"NOPE\"}")
            .andExpect(status().isNotFound());
    }

    @Test
    void planOnlyIsValidatedAgainstCurrentCareer() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"S10-Rev23\"}").andExpect(status().isOk());
        patchProfile("{\"plan\":\"S10 - Rev18\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10 - Rev18"));
        patchProfile("{\"plan\":\"I22\"}").andExpect(status().isBadRequest());
    }

    @Test
    void careerChangeWithoutPlanClearsPlan() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"S10-Rev23\"}").andExpect(status().isOk());
        patchProfile("{\"careerId\":\"I\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("I"))
            .andExpect(jsonPath("$.plan").doesNotExist());
        assertThat(reload().getPlan()).isNull();
    }

    @Test
    void sameCareerWithoutPlanKeepsPlan() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"S10-Rev23\"}").andExpect(status().isOk());
        patchProfile("{\"careerId\":\"S\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.plan").value("S10-Rev23"));
    }

    @Test
    void clearingCareerClearsPlan() throws Exception {
        patchProfile("{\"careerId\":\"S\",\"plan\":\"S10-Rev23\"}").andExpect(status().isOk());
        patchProfile("{\"careerId\":\"\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").doesNotExist())
            .andExpect(jsonPath("$.plan").doesNotExist());
    }

    @Test
    void socialHandlesAreNormalizedFromUrlsAndAtHandles() throws Exception {
        patchProfile("""
                {"linkedin":"https://www.linkedin.com/in/Jane-Doe-123/?trk=x",
                 "instagram":"@Jane.Doe_",
                 "discord":"@Jane_Doe"}
                """)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.linkedin").value("jane-doe-123"))
            .andExpect(jsonPath("$.instagram").value("jane.doe_"))
            .andExpect(jsonPath("$.discord").value("jane_doe"));

        patchProfile("{\"instagram\":\"instagram.com/other.handle/\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.instagram").value("other.handle"))
            // Untouched fields stay.
            .andExpect(jsonPath("$.linkedin").value("jane-doe-123"));

        var u = reload();
        assertThat(u.getLinkedin()).isEqualTo("jane-doe-123");
        assertThat(u.getInstagram()).isEqualTo("other.handle");
        assertThat(u.getDiscord()).isEqualTo("jane_doe");
    }

    @Test
    void socialHandlesCanBeCleared() throws Exception {
        patchProfile("{\"linkedin\":\"jane-doe\",\"discord\":\"Legacy Name#1234\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.discord").value("Legacy Name#1234"));
        patchProfile("{\"linkedin\":\"\",\"discord\":\"  \"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.linkedin").doesNotExist())
            .andExpect(jsonPath("$.discord").doesNotExist());
    }

    @Test
    void invalidSocialHandlesAre400() throws Exception {
        patchProfile("{\"linkedin\":\"https://www.linkedin.com/company/acme\"}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
        patchProfile("{\"instagram\":\"https://evil.example/instagram.com/x\"}")
            .andExpect(status().isBadRequest());
        patchProfile("{\"instagram\":\"" + "a".repeat(31) + "\"}")
            .andExpect(status().isBadRequest());
        patchProfile("{\"discord\":\"x\"}")
            .andExpect(status().isBadRequest());
        // Bean-validation length cap on the raw input.
        patchProfile("{\"linkedin\":\"" + "a".repeat(256) + "\"}")
            .andExpect(status().isBadRequest());
        assertThat(reload().getLinkedin()).isNull();
    }

    @Test
    void authMeExposesSocialHandles() throws Exception {
        patchProfile("{\"linkedin\":\"jane-doe\",\"instagram\":\"jane\",\"discord\":\"jane\"}")
            .andExpect(status().isOk());
        mvc.perform(get("/v1/auth/me").with(alice()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.linkedin").value("jane-doe"))
            .andExpect(jsonPath("$.instagram").value("jane"))
            .andExpect(jsonPath("$.discord").value("jane"));
    }

    @Test
    void savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently() throws Exception {
        // Regression: a profile/preferences save used to UPDATE every column,
        // so a file number / career the SGA sync committed between the read
        // and the flush was reset to the stale NULL. With @DynamicUpdate only
        // the changed columns are written.
        var id = reload().getId();
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            var managed = userRepo.findById(id).orElseThrow();
            managed.setTheme("dark");
            // Committed on another connection while this transaction still
            // holds the stale snapshot (file_number NULL).
            try (var other = dataSource.getConnection();
                 var st = other.prepareStatement(
                     "UPDATE public.\"user\" SET file_number = 61234, career_id = 'S' WHERE id = ?")) {
                st.setObject(1, id);
                assertThat(st.executeUpdate()).isEqualTo(1);
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException(e);
            }
            userRepo.save(managed);
        });

        var after = reload();
        assertThat(after.getTheme()).isEqualTo("dark");
        assertThat(after.getFileNumber()).isEqualTo(61234);
        mvc.perform(get("/v1/me/profile").with(alice()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("S"));
    }
}
