package org.ceitba.api.web.correction;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The schedule-corrections rules of src/main/resources/application.yml
// (the test application.yml shadows it), with small capacities: suggestions
// are limited per IP on POST only, votes on PUT/DELETE only.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "rate-limit.enabled=true",
    "rate-limit.trust-forwarded-for=true",
    "rate-limit.rules.schedule-corrections.paths[0]=/v1/commissions/*/schedule-corrections",
    "rate-limit.rules.schedule-corrections.methods[0]=POST",
    "rate-limit.rules.schedule-corrections.capacity=2",
    "rate-limit.rules.schedule-corrections.period=1h",
    "rate-limit.rules.schedule-correction-votes.paths[0]=/v1/schedule-corrections/*/vote",
    "rate-limit.rules.schedule-correction-votes.methods[0]=PUT",
    "rate-limit.rules.schedule-correction-votes.methods[1]=DELETE",
    "rate-limit.rules.schedule-correction-votes.capacity=2",
    "rate-limit.rules.schedule-correction-votes.period=1m"
})
class ScheduleCorrectionRateLimitIT {

    @Autowired MockMvc mvc;

    @Test
    void suggestionsAreLimitedPerIp() throws Exception {
        String ip = "203.0.113.20";
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/v1/commissions/nope/schedule-corrections").header("X-Forwarded-For", ip)
                    .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar")))
                    .contentType(MediaType.APPLICATION_JSON).content("{\"schedule\":[]}"))
                .andExpect(status().isNotFound());
        }
        mvc.perform(post("/v1/commissions/nope/schedule-corrections").header("X-Forwarded-For", ip)
                .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar")))
                .contentType(MediaType.APPLICATION_JSON).content("{\"schedule\":[]}"))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.error").value("TooManyRequests"));

        // Another client is unaffected.
        mvc.perform(post("/v1/commissions/nope/schedule-corrections").header("X-Forwarded-For", "203.0.113.21")
                .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar")))
                .contentType(MediaType.APPLICATION_JSON).content("{\"schedule\":[]}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void votesAreLimitedPerIpOnWritesOnly() throws Exception {
        String ip = "203.0.113.22";
        String path = "/v1/schedule-corrections/" + UUID.randomUUID() + "/vote";
        mvc.perform(put(path).header("X-Forwarded-For", ip)
                .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar")))
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"CONFIRM\"}"))
            .andExpect(status().isNotFound());
        mvc.perform(delete(path).header("X-Forwarded-For", ip)
                .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar"))))
            .andExpect(status().isNotFound());
        mvc.perform(delete(path).header("X-Forwarded-For", ip)
                .with(jwt().jwt(t -> t.claim("email", "a@itba.edu.ar"))))
            .andExpect(status().isTooManyRequests());

        // Public reads stay unlimited.
        for (int i = 0; i < 4; i++) {
            mvc.perform(get("/v1/careers").header("X-Forwarded-For", ip)).andExpect(status().isOk());
        }
    }
}
