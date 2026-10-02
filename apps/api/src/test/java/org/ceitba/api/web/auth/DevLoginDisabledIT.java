package org.ceitba.api.web.auth;

import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The flag alone is not enough: without the `dev` profile dev login does not
// exist (no controller; the path is not even permitted). Also: without a
// Drive key or the fake, the student Drive endpoints answer 503.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true",
    "auth.dev-login.enabled=true"
})
class DevLoginDisabledIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;

    @Test
    void devLoginDoesNotExistWithoutTheDevProfile() throws Exception {
        String body = "{\"email\":\"alumno1@itba.edu.ar\",\"staff\":true}";
        // Anonymous callers are not let through at all...
        mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        // ...and for a signed-in caller there is no such endpoint.
        mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON).content(body)
                .with(jwt().jwt(t -> t.claim("email", "x@itba.edu.ar"))))
            .andExpect(status().isNotFound());
        assertThat(users.findByEmail("alumno1@itba.edu.ar")).isEmpty();
    }

    @Test
    void driveEndpointsAnswer503WhenUnconfigured() throws Exception {
        mvc.perform(get("/v1/me/drive/info").with(jwt().jwt(t -> t.claim("email", "x@itba.edu.ar"))))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("DRIVE_SYNC_UNCONFIGURED"));
    }
}
