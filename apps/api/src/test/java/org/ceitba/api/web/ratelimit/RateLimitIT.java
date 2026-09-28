package org.ceitba.api.web.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies the filter is wired into the security chain and bound from config.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true",
    "rate-limit.enabled=true",
    "rate-limit.trust-forwarded-for=true",
    "rate-limit.rules.auth.paths[0]=/v1/auth/**",
    "rate-limit.rules.auth.exclude-paths[0]=/v1/auth/me",
    "rate-limit.rules.auth.capacity=2",
    "rate-limit.rules.auth.period=1m"
})
class RateLimitIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;

    @Test
    void authEndpointsAreLimitedPerIp() throws Exception {
        String ip = "203.0.113.7";
        mvc.perform(get("/v1/auth/google").header("X-Forwarded-For", ip)).andExpect(status().isFound());
        mvc.perform(get("/v1/auth/google").header("X-Forwarded-For", ip)).andExpect(status().isFound());
        mvc.perform(get("/v1/auth/google").header("X-Forwarded-For", ip))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.error").value("TooManyRequests"));

        // Another client is unaffected.
        mvc.perform(get("/v1/auth/google").header("X-Forwarded-For", "203.0.113.8")).andExpect(status().isFound());
    }

    @Test
    void publicNonAuthEndpointsAreNotLimited() throws Exception {
        String ip = "203.0.113.9";
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/v1/careers").header("X-Forwarded-For", ip)).andExpect(status().isOk());
        }
    }

    @Test
    void excludedAuthPathIsNotLimited() throws Exception {
        String ip = "203.0.113.10";
        for (int i = 0; i < 5; i++) {
            // Unauthenticated -> 401, but never 429.
            mvc.perform(get("/v1/auth/me").header("X-Forwarded-For", ip)).andExpect(status().isUnauthorized());
        }
    }
}
