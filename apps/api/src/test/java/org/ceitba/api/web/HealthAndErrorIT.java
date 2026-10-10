package org.ceitba.api.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class HealthAndErrorIT {

    @Autowired MockMvc mvc;

    @Test
    void rootReturnsApiStatus() throws Exception {
        mvc.perform(get("/"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("CEITBA API is running"))
            .andExpect(jsonPath("$.version").value("1.0.0"))
            .andExpect(jsonPath("$.timestamp").exists());
    }

    @Test
    void healthReturnsHealthy() throws Exception {
        mvc.perform(get("/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("healthy"))
            .andExpect(jsonPath("$.uptime").exists())
            .andExpect(jsonPath("$.memory.used").exists());
    }

    @Test
    void actuatorHealthReturns200() throws Exception {
        mvc.perform(get("/actuator/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void openApiDocsAreServed() throws Exception {
        mvc.perform(get("/v3/api-docs"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.info.title").value("CEITBA API"))
            .andExpect(jsonPath("$.components.securitySchemes.bearerAuth.scheme").value("bearer"))
            .andExpect(jsonPath("$.components.securitySchemes.apiKey.in").value("header"));
    }

    // Spring MVC rejections keep their own status (used to be 500s).
    @Test
    void wrongMethodReturns405() throws Exception {
        mvc.perform(put("/v1/articles").with(staff()))
            .andExpect(status().isMethodNotAllowed())
            .andExpect(header().exists("Allow"))
            .andExpect(jsonPath("$.error").value("MethodNotAllowed"))
            .andExpect(jsonPath("$.path").value("/v1/articles"));
    }

    @Test
    void wrongContentTypeReturns415() throws Exception {
        mvc.perform(post("/v1/articles").with(staff())
                .contentType(MediaType.TEXT_PLAIN).content("hello"))
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.error").value("UnsupportedMediaType"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }
}
