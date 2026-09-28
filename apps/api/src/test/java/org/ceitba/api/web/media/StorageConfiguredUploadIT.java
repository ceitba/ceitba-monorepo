package org.ceitba.api.web.media;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.repository.UserRepository;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Storage configured with dummy R2 credentials: presigning is local SigV4
// computation, so the real S3Presigner runs without a bucket. Also turns on
// the per-user quota for proposal attachments.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "storage.endpoint=https://acct.r2.cloudflarestorage.com",
    "storage.bucket=ceitba-test",
    "storage.access-key-id=AKIDTEST",
    "storage.secret-access-key=secret",
    "storage.public-base-url=https://media.test",
    "rate-limit.enabled=true",
    "rate-limit.user-rules.proposal-attachments.capacity=3",
    "rate-limit.user-rules.proposal-attachments.period=1h"
})
class StorageConfiguredUploadIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;

    private static RequestPostProcessor as(String email, String... roles) {
        var authorities = java.util.Arrays.stream(roles)
            .map(r -> (org.springframework.security.core.GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + r)).toList();
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    @Test
    void staffImage_isSigned() throws Exception {
        mvc.perform(post("/v1/media/sign-upload").with(as("boss@itba.edu.ar", "USER", "STAFF"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":1024}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.key").value(matchesPattern("media/[0-9a-f-]{36}\\.png")))
            .andExpect(jsonPath("$.uploadUrl").value(startsWith("https://acct.r2.cloudflarestorage.com/ceitba-test/media/")))
            .andExpect(jsonPath("$.publicUrl").value(startsWith("https://media.test/media/")))
            .andExpect(jsonPath("$.method").value("PUT"))
            .andExpect(jsonPath("$.headers['Content-Type']").value("image/png"))
            .andExpect(jsonPath("$.headers['Content-Length']").value("1024"))
            .andExpect(jsonPath("$.expiresAt").exists());
    }

    @Test
    void proposalAttachment_isSignedThenRateLimitedPerUser() throws Exception {
        String body = "{\"filename\":\"doc.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":2048}";
        String user = "quota@itba.edu.ar";

        String first = null;
        for (int i = 0; i < 3; i++) {
            var res = mvc.perform(post("/v1/proposals/attachments/sign-upload").with(as(user, "USER"))
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.key").value(matchesPattern("proposals/[0-9a-f-]{36}-[0-9a-f]{16}\\.pdf")))
                .andExpect(jsonPath("$.headers['Content-Type']").value("application/pdf"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            if (first == null) first = res;
        }
        // The key is opaque: the response never carries the user id.
        String key = json.readTree(first).get("key").asText();
        var userId = users.findByEmail(user).orElseThrow().getId().toString();
        assertThat(first).doesNotContain(userId).doesNotContain(userId.replace("-", ""));

        mvc.perform(post("/v1/proposals/attachments/sign-upload").with(as(user, "USER"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.error").value("TooManyRequests"));

        // Another user has their own bucket.
        mvc.perform(post("/v1/proposals/attachments/sign-upload").with(as("other@itba.edu.ar", "USER"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.key").value(org.hamcrest.Matchers.not(key)));
    }

    @Test
    void proposalAcceptsOnlyTheAuthorsSignedKeys() throws Exception {
        String author = "attach@itba.edu.ar";
        String png = json.readTree(mvc.perform(post("/v1/proposals/attachments/sign-upload").with(as(author, "USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.png\",\"contentType\":\"image/png\",\"sizeBytes\":10}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
            .get("key").asText();
        String pdf = json.readTree(mvc.perform(post("/v1/proposals/attachments/sign-upload").with(as(author, "USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"b.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":10}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
            .get("key").asText();

        String body = "{\"title\":\"Con adjuntos\",\"description\":\"d\",\"topic\":\"OTROS\","
            + "\"attachmentKeys\":[\"" + pdf + "\",\"" + png + "\"]}";

        // Someone else cannot attach the author's uploads.
        mvc.perform(post("/v1/proposals").with(as("thief@itba.edu.ar", "USER"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/v1/proposals").with(as(author, "USER"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.attachments[0].position").value(0))
            .andExpect(jsonPath("$.attachments[0].contentType").value("application/pdf"))
            .andExpect(jsonPath("$.attachments[0].url").value("https://media.test/" + pdf))
            .andExpect(jsonPath("$.attachments[1].contentType").value("image/png"))
            .andExpect(jsonPath("$.attachments[1].url").value("https://media.test/" + png));

        // A key can back only one proposal.
        mvc.perform(post("/v1/proposals").with(as(author, "USER"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());
    }
}
