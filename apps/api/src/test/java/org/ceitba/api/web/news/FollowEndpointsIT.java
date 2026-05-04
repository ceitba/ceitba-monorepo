package org.ceitba.api.web.news;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
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

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class FollowEndpointsIT {

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
    @Autowired OrganizationRepository orgRepo;
    @Autowired UserFollowRepository followRepo;

    @BeforeEach
    void seed() {
        followRepo.deleteAll();
        userRepo.deleteAll();
        orgRepo.deleteAll();

        orgRepo.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes del ITBA"));
        orgRepo.save(new Organization("sabf", "SABF", "South American Business Forum"));

        userRepo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void anonymousCannotListFollows() throws Exception {
        mvc.perform(get("/v1/me/follows"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void firstLoginAutoFollowsCeitba() throws Exception {
        // Bob has never logged in: CurrentUserResolver JIT-provisions the row,
        // and the new-user branch should auto-follow CEITBA.
        mvc.perform(get("/v1/auth/me")
                .with(jwt().jwt(t -> t
                    .claim("email", "bob@itba.edu.ar")
                    .claim("name", "Bob"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.follows").isArray())
            .andExpect(jsonPath("$.follows[0]").value("ceitba"));
    }

    @Test
    void followAndListReturnsRow() throws Exception {
        mvc.perform(post("/v1/me/follows/sabf").with(user()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.orgSlug").value("sabf"));

        mvc.perform(get("/v1/me/follows").with(user()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].orgSlug").value("sabf"));
    }

    @Test
    void unfollowRemovesRow() throws Exception {
        var alice = userRepo.findByEmail("alice@itba.edu.ar").orElseThrow();
        followRepo.save(new UserFollow(alice.getId(), "ceitba"));
        followRepo.save(new UserFollow(alice.getId(), "sabf"));

        mvc.perform(delete("/v1/me/follows/ceitba").with(user()))
            .andExpect(status().isNoContent());

        mvc.perform(get("/v1/me/follows").with(user()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].orgSlug").value("sabf"));
    }

    @Test
    void followUnknownOrgReturns404() throws Exception {
        mvc.perform(post("/v1/me/follows/no-such-org").with(user()))
            .andExpect(status().isNotFound());
    }

    @Test
    void followIsIdempotent() throws Exception {
        mvc.perform(post("/v1/me/follows/sabf").with(user()))
            .andExpect(status().isCreated());
        mvc.perform(post("/v1/me/follows/sabf").with(user()))
            .andExpect(status().isCreated());
        mvc.perform(get("/v1/me/follows").with(user()))
            .andExpect(jsonPath("$.length()").value(1));
    }
}
