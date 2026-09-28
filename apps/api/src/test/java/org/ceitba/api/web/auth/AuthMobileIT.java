package org.ceitba.api.web.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.repository.RefreshTokenRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.Date;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/auth/google/mobile end to end: the real JwksGoogleIdTokenVerifier
// (backed by a local RSA key instead of Google's JWKS), the shared
// GoogleLoginService gate, provisioning, and the issued token pair.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(TestGoogleIdTokens.LocalKeyVerifier.class)
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "auth.allowed-emails=friend@gmail.com,boss@acme.com",
    "auth.google.mobile-audiences=" + TestGoogleIdTokens.WEB_CLIENT + "," + TestGoogleIdTokens.IOS_CLIENT,
    "itba.api.use-fake=true"
})
class AuthMobileIT {

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
    @Autowired RefreshTokenRepository refreshTokens;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
    }

    private ResultActions login(Map<String, Object> body) throws Exception {
        return mvc.perform(post("/v1/auth/google/mobile")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(body)));
    }

    private ResultActions login(String idToken) throws Exception {
        return login(Map.of("idToken", idToken, "deviceName", "Pixel 8"));
    }

    @Test
    void validTokenReturnsTokenPairAndProvisionsUser() throws Exception {
        var before = Instant.now();
        var res = login(TestGoogleIdTokens.token("alice@itba.edu.ar"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.accessToken").isString())
            .andExpect(jsonPath("$.refreshToken").isString())
            .andExpect(jsonPath("$.user.email").value("alice@itba.edu.ar"))
            .andExpect(jsonPath("$.user.name").value("Test alice@itba.edu.ar"))
            .andExpect(jsonPath("$.user.role").value("user"))
            .andReturn();
        JsonNode body = json.readTree(res.getResponse().getContentAsString());

        // Access TTL defaults to 15 minutes; refresh TTL to 60 days.
        var accessExp = Instant.parse(body.get("accessTokenExpiresAt").asText());
        assertThat(accessExp).isBetween(before.plusSeconds(14 * 60), before.plusSeconds(16 * 60));
        var refreshExp = Instant.parse(body.get("refreshTokenExpiresAt").asText());
        assertThat(refreshExp).isAfter(before.plusSeconds(59L * 24 * 3600));

        var user = users.findByEmail("alice@itba.edu.ar").orElseThrow();
        assertThat(user.getGoogleSub()).isEqualTo("google-alice@itba.edu.ar");
        assertThat(refreshTokens.findAll()).singleElement()
            .satisfies(t -> assertThat(t.getDeviceName()).isEqualTo("Pixel 8"));

        // The access token is a real bearer for the API (HS256 + iss/aud checks).
        mvc.perform(get("/v1/auth/me")
                .header("Authorization", "Bearer " + body.get("accessToken").asText()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(user.getId().toString()));
    }

    @Test
    void iosAudienceIsAlsoAccepted() throws Exception {
        login(TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b.audience(TestGoogleIdTokens.IOS_CLIENT)))
            .andExpect(status().isOk());
    }

    @Test
    void unverifiedEmailIsRejected() throws Exception {
        login(TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b.claim("email_verified", false)))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("unverified_email"));
        assertThat(users.count()).isZero();
    }

    @Test
    void emailOutsideAllowlistIsRejected() throws Exception {
        login(TestGoogleIdTokens.token("mallory@gmail.com"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("unauthorized"));
        assertThat(users.count()).isZero();
        assertThat(refreshTokens.count()).isZero();
    }

    @Test
    void explicitlyAllowlistedGmailIsAccepted() throws Exception {
        login(TestGoogleIdTokens.token("friend@gmail.com")).andExpect(status().isOk());
    }

    @Test
    void workspaceDomainOutsideAllowlistIsRejected() throws Exception {
        login(TestGoogleIdTokens.token("boss@acme.com", b -> b.claim("hd", "acme.com")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("unauthorized_workspace"));
    }

    @Test
    void wrongAudienceIsRejected() throws Exception {
        login(TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b.audience("someone-elses-app.apps.googleusercontent.com")))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_token"));
        assertThat(users.count()).isZero();
    }

    @Test
    void wrongIssuerIsRejected() throws Exception {
        login(TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b.issuer("https://evil.example.com")))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_token"));
    }

    @Test
    void expiredTokenIsRejected() throws Exception {
        var past = Instant.now().minusSeconds(3600);
        login(TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b
                .issueTime(Date.from(past.minusSeconds(3600)))
                .expirationTime(Date.from(past))))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_token"));
    }

    @Test
    void tamperedTokenIsRejected() throws Exception {
        String token = TestGoogleIdTokens.token("alice@itba.edu.ar");
        String tampered = token.substring(0, token.length() - 4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
        login(tampered).andExpect(status().isUnauthorized());
    }

    @Test
    void nonceMustMatchWhenProvided() throws Exception {
        String token = TestGoogleIdTokens.token("alice@itba.edu.ar", b -> b.claim("nonce", "n-123"));
        login(Map.of("idToken", token, "nonce", "other"))
            .andExpect(status().isUnauthorized());
        login(Map.of("idToken", token, "nonce", "n-123"))
            .andExpect(status().isOk());
    }

    @Test
    void missingIdTokenIsBadRequest() throws Exception {
        login(Map.of("deviceName", "x")).andExpect(status().isBadRequest());
    }

    @Test
    void repeatedLoginReusesTheSameUserAndStartsNewFamilies() throws Exception {
        String first = json.readTree(login(TestGoogleIdTokens.token("alice@itba.edu.ar"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
            .at("/user/id").asText();
        String second = json.readTree(login(TestGoogleIdTokens.token("alice@itba.edu.ar"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
            .at("/user/id").asText();

        assertThat(second).isEqualTo(first);
        assertThat(users.count()).isEqualTo(1);
        assertThat(refreshTokens.findAll())
            .hasSize(2)
            .extracting(t -> t.getFamilyId())
            .doesNotHaveDuplicates();
    }

    @Test
    void loginIgnoresAStaleBearerToken() throws Exception {
        mvc.perform(post("/v1/auth/google/mobile")
                .header("Authorization", "Bearer not-a-valid-jwt")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("idToken", TestGoogleIdTokens.token("alice@itba.edu.ar")))))
            .andExpect(status().isOk());
    }
}
