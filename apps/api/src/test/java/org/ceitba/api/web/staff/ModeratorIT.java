package org.ceitba.api.web.staff;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.auth.StaffAwareJwtAuthenticationConverter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Collection;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// MODERATOR grant lifecycle under /v1/staff/moderators, the ROLE_MODERATOR
// authority from StaffAwareJwtAuthenticationConverter, and `moderator` on
// /v1/auth/me.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "itba.api.use-fake=true"})
class ModeratorIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String BOSS = "boss@itba.edu.ar";
    private static final String ALICE = "alice@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired CeitbaStaffRepository staffRepo;
    @Autowired CeitbaModeratorRepository moderatorRepo;
    @Autowired StaffAwareJwtAuthenticationConverter converter;
    @Autowired PlatformTransactionManager txManager;

    private User boss;
    private User alice;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        new TransactionTemplate(txManager).executeWithoutResult(s -> {
            boss = users.save(new User(UUID.randomUUID(), BOSS, "Boss"));
            staffRepo.save(new CeitbaStaff(boss, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().minus(1, ChronoUnit.DAYS),
                OffsetDateTime.now().plus(30, ChronoUnit.DAYS)));
        });
        alice = users.save(new User(UUID.randomUUID(), ALICE, "Alice"));
    }

    private static RequestPostProcessor as(String email, String... roles) {
        GrantedAuthority[] authorities = Arrays.stream(roles)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    private static RequestPostProcessor staff() {
        return as(BOSS, "USER", "STAFF", "MODERATOR");
    }

    private Collection<String> authoritiesOf(String email) {
        var jwt = Jwt.withTokenValue("t").header("alg", "HS256")
            .claim("email", email).subject(email).build();
        return converter.convert(jwt).getAuthorities().stream().map(Object::toString).toList();
    }

    private void grantAlice() throws Exception {
        mvc.perform(post("/v1/staff/moderators").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + ALICE + "\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.userId").value(alice.getId().toString()))
            .andExpect(jsonPath("$.email").value(ALICE))
            .andExpect(jsonPath("$.grantedBy").value(boss.getId().toString()));
    }

    @Test
    void staffGrantsAndRevokesModerator() throws Exception {
        assertThat(authoritiesOf(ALICE)).containsExactly("ROLE_USER");

        grantAlice();
        assertThat(authoritiesOf(ALICE)).containsExactlyInAnyOrder("ROLE_USER", "ROLE_MODERATOR");
        mvc.perform(get("/v1/staff/moderators").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].email").value(ALICE));
        mvc.perform(get("/v1/auth/me").with(as(ALICE, "USER", "MODERATOR")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.role").value("user"))
            .andExpect(jsonPath("$.moderator").value(true));

        mvc.perform(delete("/v1/staff/moderators/" + alice.getId()).with(staff()))
            .andExpect(status().isNoContent());
        assertThat(authoritiesOf(ALICE)).containsExactly("ROLE_USER");
        mvc.perform(get("/v1/staff/moderators").with(staff()))
            .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/v1/auth/me").with(as(ALICE, "USER")))
            .andExpect(jsonPath("$.moderator").value(false));

        // Revoked rows are kept for audit.
        var row = moderatorRepo.findById(alice.getId()).orElseThrow();
        assertThat(row.getRevokedAt()).isNotNull();
        assertThat(row.getRevokedBy()).isEqualTo(boss.getId());
    }

    @Test
    void regrantAfterRevokeReactivates() throws Exception {
        grantAlice();
        mvc.perform(delete("/v1/staff/moderators/" + alice.getId()).with(staff()))
            .andExpect(status().isNoContent());
        grantAlice();
        assertThat(moderatorRepo.isActiveModerator(alice.getId())).isTrue();
    }

    @Test
    void duplicateGrantIs409AndUnknownUserIs404() throws Exception {
        grantAlice();
        mvc.perform(post("/v1/staff/moderators").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + ALICE + "\"}"))
            .andExpect(status().isConflict());
        mvc.perform(post("/v1/staff/moderators").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"ghost@itba.edu.ar\"}"))
            .andExpect(status().isNotFound());
        mvc.perform(post("/v1/staff/moderators").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"not-an-email\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void revokeWithoutActiveGrantIs404() throws Exception {
        mvc.perform(delete("/v1/staff/moderators/" + alice.getId()).with(staff()))
            .andExpect(status().isNotFound());
    }

    @Test
    void staffImpliesModerator() throws Exception {
        assertThat(authoritiesOf(BOSS)).containsExactlyInAnyOrder("ROLE_USER", "ROLE_STAFF", "ROLE_MODERATOR");
        mvc.perform(get("/v1/auth/me").with(staff()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.role").value("staff"))
            .andExpect(jsonPath("$.moderator").value(true));
        // Implicit moderators are not listed as grants.
        mvc.perform(get("/v1/staff/moderators").with(staff()))
            .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void userAndModeratorCannotManageGrants() throws Exception {
        for (var rp : new RequestPostProcessor[]{as(ALICE, "USER"), as(ALICE, "USER", "MODERATOR")}) {
            mvc.perform(post("/v1/staff/moderators").with(rp)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + ALICE + "\"}"))
                .andExpect(status().isForbidden());
            mvc.perform(get("/v1/staff/moderators").with(rp)).andExpect(status().isForbidden());
            mvc.perform(delete("/v1/staff/moderators/" + alice.getId()).with(rp)).andExpect(status().isForbidden());
        }
        mvc.perform(get("/v1/staff/moderators")).andExpect(status().isUnauthorized());
        assertThat(moderatorRepo.count()).isZero();
    }
}
