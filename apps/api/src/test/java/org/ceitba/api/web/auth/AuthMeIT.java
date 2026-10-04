package org.ceitba.api.web.auth;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.CeitbaModerator;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.UserRepository;
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

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class AuthMeIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;
    @Autowired CareerRepository careerRepo;
    @Autowired CeitbaModeratorRepository moderatorRepo;

    private User alice;

    @BeforeEach
    void seed() {
        // Delete wiki data that may reference users before clearing users
        userRepo.deleteAll();
        careerRepo.deleteAll();

        var s = careerRepo.save(new Career("S", "Ingeniería en Informática"));
        var u = new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice");
        u.setAvatarUrl("https://example.com/avatar.jpg");
        u.setCareer(s);
        u.setPlan("S10-Rev23");
        u.setFileNumber(61234);
        u.setLinkedin("alice-doe");
        u.setInstagram("alice.doe");
        u.setDiscord("alice_doe");
        alice = userRepo.save(u);
    }

    private static org.springframework.test.web.servlet.request.RequestPostProcessor aliceJwt() {
        return jwt().jwt(t -> t
                .claim("email", "alice@itba.edu.ar")
                .claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void meIncludesAcademicAndSocialProfile() throws Exception {
        mvc.perform(get("/v1/auth/me").with(aliceJwt()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.careerId").value("S"))
            .andExpect(jsonPath("$.plan").value("S10-Rev23"))
            .andExpect(jsonPath("$.fileNumber").value(61234))
            .andExpect(jsonPath("$.linkedin").value("alice-doe"))
            .andExpect(jsonPath("$.instagram").value("alice.doe"))
            .andExpect(jsonPath("$.discord").value("alice_doe"));
    }

    @Test
    void meModeratorFlagFollowsActiveGrant() throws Exception {
        mvc.perform(get("/v1/auth/me").with(aliceJwt()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.moderator").value(false));

        var grant = moderatorRepo.save(new CeitbaModerator(alice.getId(), null, OffsetDateTime.now()));
        mvc.perform(get("/v1/auth/me").with(aliceJwt()))
            .andExpect(jsonPath("$.moderator").value(true))
            .andExpect(jsonPath("$.role").value("user"));

        grant.revoke(null, OffsetDateTime.now());
        moderatorRepo.save(grant);
        mvc.perform(get("/v1/auth/me").with(aliceJwt()))
            .andExpect(jsonPath("$.moderator").value(false));
    }

    @Test
    void meRequiresAuthentication() throws Exception {
        mvc.perform(get("/v1/auth/me"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void meReturnsUserProfile() throws Exception {
        mvc.perform(get("/v1/auth/me")
                .with(jwt().jwt(t -> t
                    .claim("email", "alice@itba.edu.ar")
                    .claim("name", "Alice"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.name").value("Alice"))
            .andExpect(jsonPath("$.role").value("user"))
            .andExpect(jsonPath("$.avatarUrl").value("https://example.com/avatar.jpg"))
            .andExpect(jsonPath("$.id").isNotEmpty());
    }

    @Test
    void meCreatesUserIfFirstLogin() throws Exception {
        // "bob" has never logged in — CurrentUserResolver JIT-provisions the row
        mvc.perform(get("/v1/auth/me")
                .with(jwt().jwt(t -> t
                    .claim("email", "bob@itba.edu.ar")
                    .claim("name", "Bob"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("bob@itba.edu.ar"))
            .andExpect(jsonPath("$.name").value("Bob"))
            .andExpect(jsonPath("$.role").value("user"))
            .andExpect(jsonPath("$.moderator").value(false))
            .andExpect(jsonPath("$.careerId").doesNotExist())
            .andExpect(jsonPath("$.linkedin").doesNotExist());
    }

    @Test
    void meIncludesEmptyOrganizationsByDefault() throws Exception {
        mvc.perform(get("/v1/auth/me")
                .with(jwt().jwt(t -> t
                    .claim("email", "alice@itba.edu.ar")
                    .claim("name", "Alice"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organizations").isArray())
            .andExpect(jsonPath("$.organizations.length()").value(0))
            .andExpect(jsonPath("$.follows").isArray());
    }

    @Test
    void meRoleIsUserWithoutActiveCeitbaStaffRow() throws Exception {
        // No CeitbaStaff row for this user → role must be "user" even with ROLE_STAFF authority
        mvc.perform(get("/v1/auth/me")
                .with(jwt().jwt(t -> t
                    .claim("email", "alice@itba.edu.ar")
                    .claim("name", "Alice"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"),
                                 new SimpleGrantedAuthority("ROLE_STAFF"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.role").value("user")); // DB has no CeitbaStaff row
    }
}
