package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "auth.allowed-emails=external@gmail.com",
    "auth.sync-api-key=test-sync-key",
    "itba.api.use-fake=true"
})
class AuthIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired AuthProperties authProps;

    @Test
    void publicEndpointsAreReachableWithoutAuth() throws Exception {
        mvc.perform(get("/health")).andExpect(status().isOk());
        mvc.perform(get("/v1/careers")).andExpect(status().isOk());
        mvc.perform(get("/v1/wiki/bookmarks/93.12")).andExpect(status().isOk())
            .andExpect(jsonPath("$.bookmarked").value(false));
    }

    @Test
    void protectedEndpointWithoutTokenReturns401() throws Exception {
        mvc.perform(post("/v1/wiki/bookmarks/93.12"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void syncWithoutApiKeyReturns401() throws Exception {
        mvc.perform(post("/v1/sync/all"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void syncWithWrongApiKeyReturns401() throws Exception {
        mvc.perform(post("/v1/sync/all").header(ApiKeyFilter.HEADER, "wrong-key"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void syncWithCorrectApiKeyIsAllowed() throws Exception {
        // 200 with empty result (no careers/plans seeded) — auth passes, the request reaches the service.
        mvc.perform(post("/v1/sync/all").header(ApiKeyFilter.HEADER, "test-sync-key"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalProcessed").value(0));
    }

    @Test
    void allowlistAdmitsItbaDomain() {
        assertThat(authProps.admits("alice@itba.edu.ar")).isTrue();
    }

    @Test
    void allowlistAdmitsExplicitlyListedExternalEmail() {
        assertThat(authProps.admits("external@gmail.com")).isTrue();
    }

    @Test
    void allowlistRejectsUnknownDomain() {
        assertThat(authProps.admits("bob@gmail.com")).isFalse();
    }

    @Test
    void allowlistIsCaseInsensitive() {
        assertThat(authProps.admits("ALICE@ITBA.EDU.AR")).isTrue();
        assertThat(authProps.admits("External@Gmail.com")).isTrue();
    }
}
