package org.ceitba.api.web.staff;

import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Exercises the path-based hasRole("STAFF") gate. Note that .with(jwt()) sets
// authorities directly (the StaffAwareJwtAuthenticationConverter is bypassed
// in MockMvc); we pass authorities explicitly to test gating. The converter
// itself is exercised in AuthIT + the role detection in
// StaffRoleDetectionIT.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class StaffEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepository;
    @Autowired CeitbaStaffRepository staffRepository;

    @Autowired PlatformTransactionManager txManager;

    private UUID aliceId;
    private UUID bobId;

    @BeforeEach
    void seed() {
        staffRepository.deleteAll();
        userRepository.deleteAll();
        var alice = userRepository.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        bobId = userRepository.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob")).getId();
        aliceId = alice.getId();
    }

    // Bob as a second active staff member, so revoking Alice isn't blocked
    // by the last-active-staff guard.
    private void seedBobAsActiveStaff() {
        seedStaff(bobId, OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusYears(1));
    }

    // In a transaction so the User is managed when the @MapsId row is saved.
    private void seedStaff(UUID userId, OffsetDateTime start, OffsetDateTime end) {
        new TransactionTemplate(txManager).executeWithoutResult(tx ->
            staffRepository.save(new CeitbaStaff(userRepository.findById(userId).orElseThrow(),
                CeitbaBranch.IT, CeitbaStaffRole.MEMBER, start, end)));
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
    void anonymousCannotListStaff() throws Exception {
        mvc.perform(get("/v1/staff")).andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCannotListStaff() throws Exception {
        mvc.perform(get("/v1/staff").with(user())).andExpect(status().isForbidden());
    }

    @Test
    void staffCanListStaff() throws Exception {
        mvc.perform(get("/v1/staff").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray());
    }

    // /v1/staff/** applies the email allowlist like every other authenticated
    // route: a STAFF JWT whose email is no longer allowlisted gets 403.
    @Test
    void staffWithNonAllowlistedEmailIsForbidden() throws Exception {
        var outsider = jwt().jwt(t -> t.claim("email", "boss@gmail.com")).authorities(
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"),
            new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_STAFF"));
        mvc.perform(get("/v1/staff").with(outsider)).andExpect(status().isForbidden());
    }

    @Test
    void staffCanAssignAndListsActiveOnly() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff")
                .with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.branch").value("IT"))
            .andExpect(jsonPath("$.role").value("MEMBER"));

        mvc.perform(get("/v1/staff").with(staff()))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].email").value("alice@itba.edu.ar"));
    }

    @Test
    void assigningSamePersonTwiceReturns409() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("ResourceAlreadyExists"));
    }

    @Test
    void assigningUnknownEmailReturns404() throws Exception {
        var body = """
            {"email":"ghost@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isNotFound());
    }

    @Test
    void startAfterEndReturns400() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2027-01-01T00:00:00Z","end":"2026-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void revokeEndDatesActiveMembershipSoListingDropsIt() throws Exception {
        seedBobAsActiveStaff();
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2030-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());

        mvc.perform(delete("/v1/staff/" + aliceId).with(staff()))
            .andExpect(status().isNoContent());

        mvc.perform(get("/v1/staff").with(staff()))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].email").value("bob@itba.edu.ar"));
    }

    @Test
    void reassigningAfterRevokeGrantsStaffAgain() throws Exception {
        seedBobAsActiveStaff();
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2030-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());
        mvc.perform(delete("/v1/staff/" + aliceId).with(staff()))
            .andExpect(status().isNoContent());

        var reassign = """
            {"email":"alice@itba.edu.ar","branch":"DIRECTIVES","role":"MEMBER",
             "start":"%s","end":"2031-01-01T00:00:00Z"}""".formatted(OffsetDateTime.now().minusMinutes(1));
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(reassign))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.branch").value("DIRECTIVES"));

        assertThat(staffRepository.isActiveStaff(aliceId, OffsetDateTime.now())).isTrue();
        mvc.perform(get("/v1/staff").with(staff()))
            .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void revokingTheLastActiveStaffMemberReturns409() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2030-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff").with(staff()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());

        mvc.perform(delete("/v1/staff/" + aliceId).with(staff()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("LastActiveStaff"));

        assertThat(staffRepository.isActiveStaff(aliceId, OffsetDateTime.now())).isTrue();
    }

    @Test
    void revokingAnExpiredMembershipReturns404AndKeepsItsEnd() throws Exception {
        seedBobAsActiveStaff();
        var end = OffsetDateTime.parse("2025-06-01T00:00:00Z");
        seedStaff(aliceId, OffsetDateTime.parse("2025-01-01T00:00:00Z"), end);

        mvc.perform(delete("/v1/staff/" + aliceId).with(staff()))
            .andExpect(status().isNotFound());

        assertThat(staffRepository.findById(aliceId).orElseThrow().getEnd()).isEqualTo(end);
    }

    @Test
    void revokingANotYetStartedMembershipDeletesIt() throws Exception {
        seedStaff(aliceId, OffsetDateTime.now().plusDays(10), OffsetDateTime.now().plusYears(1));

        mvc.perform(delete("/v1/staff/" + aliceId).with(staff()))
            .andExpect(status().isNoContent());

        assertThat(staffRepository.findById(aliceId)).isEmpty();
    }

    @Test
    void regularUserCannotAssign() throws Exception {
        var body = """
            {"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z"}""";
        mvc.perform(post("/v1/staff")
                .with(user())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
        assertThat(staffRepository.count()).isZero();
    }
}
