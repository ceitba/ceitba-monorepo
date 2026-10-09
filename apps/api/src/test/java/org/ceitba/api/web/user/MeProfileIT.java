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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class MeProfileIT {

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

    // --- fileNumber (legajo): entered once by the user ---

    @Test
    void setsFileNumberOnceAndReturnsIt() throws Exception {
        patchProfile("{\"fileNumber\":\"61234\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(61234));
        mvc.perform(get("/v1/me/profile").with(alice()))
            .andExpect(jsonPath("$.fileNumber").value(61234));
        assertThat(reload().getFileNumber()).isEqualTo(61234);

        // A retry with the same number is a no-op, not an error.
        patchProfile("{\"fileNumber\":\"61234\",\"instagram\":\"alice\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(61234))
            .andExpect(jsonPath("$.instagram").value("alice"));
    }

    @Test
    void secondDifferentFileNumberIs409AndSavesNothing() throws Exception {
        patchProfile("{\"fileNumber\":61234}").andExpect(status().isOk());

        patchProfile("{\"fileNumber\":\"61235\",\"careerId\":\"S\"}")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("FileNumberAlreadySet"));
        var u = reload();
        assertThat(u.getFileNumber()).isEqualTo(61234);
        assertThat(u.getCareer()).isNull();
    }

    @Test
    void fileNumberCannotBeClearedByTheUser() throws Exception {
        patchProfile("{\"fileNumber\":\"61234\"}").andExpect(status().isOk());
        patchProfile("{\"fileNumber\":\"\"}").andExpect(status().isBadRequest());
        // Omitting it (or null) leaves it alone.
        patchProfile("{\"fileNumber\":null,\"careerId\":\"S\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(61234));
    }

    @Test
    void fileNumberTakenByAnotherUserIs409() throws Exception {
        var bob = new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob");
        bob.setFileNumber(61234);
        userRepo.save(bob);

        patchProfile("{\"fileNumber\":\"61234\"}")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("FileNumberTaken"));
        assertThat(reload().getFileNumber()).isNull();
    }

    @Test
    void invalidFileNumberIs400() throws Exception {
        for (var bad : new String[] {"\"abc\"", "\"6123\"", "\"1234567\"", "\"06123\"", "\"61 234\"",
                "\"-6123\"", "-61234", "61234.5", "\"\""}) {
            patchProfile("{\"fileNumber\":" + bad + "}")
                .andExpect(status().isBadRequest());
        }
        assertThat(reload().getFileNumber()).isNull();
        // 6 digits are accepted (room for growth).
        patchProfile("{\"fileNumber\":\"100001\"}").andExpect(status().isOk());
    }

    @Test
    void staffCanStillChangeOrClearTheFileNumber() throws Exception {
        patchProfile("{\"fileNumber\":\"61234\"}").andExpect(status().isOk());
        var id = reload().getId();
        var bob = new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob");
        bob.setFileNumber(60000);
        userRepo.save(bob);

        // Plain users cannot use the staff path.
        staffPatchFileNumber(id, "{\"file_number\":61235}", user(EMAIL)).andExpect(status().isForbidden());

        staffPatchFileNumber(id, "{\"file_number\":61235}", staff())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.file_number").value(61235));
        mvc.perform(get("/v1/me/profile").with(alice()))
            .andExpect(jsonPath("$.fileNumber").value(61235));

        staffPatchFileNumber(id, "{\"file_number\":60000}", staff())
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("FileNumberTaken"));
        staffPatchFileNumber(id, "{\"file_number\":-1}", staff()).andExpect(status().isBadRequest());
        staffPatchFileNumber(UUID.randomUUID(), "{\"file_number\":61236}", staff())
            .andExpect(status().isNotFound());

        // Cleared by staff: the user can enter it again.
        staffPatchFileNumber(id, "{\"file_number\":null}", staff())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.file_number").doesNotExist());
        patchProfile("{\"fileNumber\":\"61236\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fileNumber").value(61236));
    }

    private org.springframework.test.web.servlet.ResultActions staffPatchFileNumber(
            UUID id, String json, RequestPostProcessor as) throws Exception {
        return mvc.perform(patch("/v1/users/{id}/file-number", id).with(as)
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "staff@itba.edu.ar").claim("name", "Staff"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    @Test
    void concurrentClaimsOfOneNumberByTwoUsersLetExactlyOneWin() throws Exception {
        userRepo.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        var statuses = race(
            () -> patchProfile("{\"fileNumber\":\"61234\"}"),
            () -> mvc.perform(patch("/v1/me/profile").with(user("bob@itba.edu.ar"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"fileNumber\":\"61234\"}")));
        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        assertThat(userRepo.findAll().stream().filter(u -> Integer.valueOf(61234).equals(u.getFileNumber())))
            .hasSize(1);
    }

    @Test
    void concurrentClaimsOfTwoNumbersByOneUserLetExactlyOneWin() throws Exception {
        var statuses = race(
            () -> patchProfile("{\"fileNumber\":\"61234\"}"),
            () -> patchProfile("{\"fileNumber\":\"61235\"}"));
        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        assertThat(reload().getFileNumber()).isIn(61234, 61235);
    }

    private interface Call {
        org.springframework.test.web.servlet.ResultActions run() throws Exception;
    }

    private static List<Integer> race(Call a, Call b) throws Exception {
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var fa = pool.submit(() -> { start.await(); return a.run().andReturn().getResponse().getStatus(); });
            var fb = pool.submit(() -> { start.await(); return b.run().andReturn().getResponse().getStatus(); });
            start.countDown();
            return List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        }
    }

    private static RequestPostProcessor user(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently() throws Exception {
        // Regression: a profile/preferences save used to UPDATE every column,
        // so a file number / career another request committed between the read
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
