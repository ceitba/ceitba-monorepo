package org.ceitba.api.web.auth;

import org.ceitba.api.domain.User;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class AuthMeIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository userRepo;

    @BeforeEach
    void seed() {
        // Delete wiki data that may reference users before clearing users
        userRepo.deleteAll();

        var u = new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice");
        u.setAvatarUrl("https://example.com/avatar.jpg");
        userRepo.save(u);
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
            .andExpect(jsonPath("$.role").value("user"));
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
            .andExpect(jsonPath("$.organizations.length()").value(0));
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
