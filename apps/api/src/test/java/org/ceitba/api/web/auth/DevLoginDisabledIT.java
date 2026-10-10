package org.ceitba.api.web.auth;

import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

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
@TestPropertySource(properties = {
    "auth.dev-login.enabled=true"
})
class DevLoginDisabledIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

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
        jdbc.update("INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true) "
            + "ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true");
        mvc.perform(get("/v1/me/drive/info").with(jwt().jwt(t -> t.claim("email", "x@itba.edu.ar"))))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("DRIVE_SYNC_UNCONFIGURED"));
    }
}
