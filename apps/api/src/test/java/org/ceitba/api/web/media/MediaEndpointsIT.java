package org.ceitba.api.web.media;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class MediaEndpointsIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"),
                         new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "student@itba.edu.ar").claim("name", "Student"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void signUpload_asUser_returns403() throws Exception {
        mvc.perform(post("/v1/media/sign-upload").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":1024}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void proposalAttachment_anonymous_returns401() throws Exception {
        mvc.perform(post("/v1/proposals/attachments/sign-upload")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":1024}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void proposalAttachment_withoutStorage_returns501() throws Exception {
        mvc.perform(post("/v1/proposals/attachments/sign-upload").with(user())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":1024}"))
            .andExpect(status().isNotImplemented())
            .andExpect(jsonPath("$.error").value("NotImplemented"));
    }

    @Test
    void proposalAttachment_validation_returns400() throws Exception {
        for (String body : new String[] {
                "{\"filename\":\"a.gif\",\"contentType\":\"image/gif\",\"sizeBytes\":1024}",
                "{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":5242881}",
                "{\"filename\":\"a.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":10485761}",
                "{\"filename\":\"a.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":0}"}) {
            mvc.perform(post("/v1/proposals/attachments/sign-upload").with(user())
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("ValidationError"));
        }
    }

    @Test
    void signUpload_withoutStorage_returns501() throws Exception {
        mvc.perform(post("/v1/media/sign-upload").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":1024}"))
            .andExpect(status().isNotImplemented())
            .andExpect(jsonPath("$.error").value("NotImplemented"));
    }

    @Test
    void signUpload_unsupportedType_returns400() throws Exception {
        mvc.perform(post("/v1/media/sign-upload").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.gif\",\"contentType\":\"image/gif\",\"sizeBytes\":1024}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }

    @Test
    void signUpload_tooLarge_returns400() throws Exception {
        mvc.perform(post("/v1/media/sign-upload").with(staff())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":10485760}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
    }
}
