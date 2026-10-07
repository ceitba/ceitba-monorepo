package org.ceitba.api.web.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies the filter is wired into the security chain and bound from config.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "rate-limit.enabled=true",
    "rate-limit.trust-forwarded-for=true",
    "rate-limit.rules.auth.paths[0]=/v1/auth/**",
    "rate-limit.rules.auth.exclude-paths[0]=/v1/auth/me",
    "rate-limit.rules.auth.capacity=2",
    "rate-limit.rules.auth.period=1m",
    "rate-limit.rules.votes.paths[0]=/v1/articles/*/votes",
    "rate-limit.rules.votes.methods[0]=POST",
    "rate-limit.rules.votes.methods[1]=DELETE",
    "rate-limit.rules.votes.capacity=2",
    "rate-limit.rules.votes.period=1m"
})
class RateLimitIT {

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

    // Anonymous vote writes are limited per IP; the GET of the counts is not.
    @Test
    void voteWritesAreLimitedButCountReadsAreNot() throws Exception {
        String ip = "203.0.113.11";
        for (int i = 0; i < 2; i++) {
            // Unknown article -> 404, but the request still spends a token.
            mvc.perform(post("/v1/articles/nope/votes").header("X-Forwarded-For", ip)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"up\"}"))
                .andExpect(status().isNotFound());
        }
        mvc.perform(delete("/v1/articles/nope/votes").header("X-Forwarded-For", ip))
            .andExpect(status().isTooManyRequests());
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/v1/articles/nope/votes").header("X-Forwarded-For", ip)).andExpect(status().isOk());
        }
    }
}
