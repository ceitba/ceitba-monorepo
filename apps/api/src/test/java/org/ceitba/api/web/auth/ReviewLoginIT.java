package org.ceitba.api.web.auth;

import org.ceitba.api.support.SharedPostgres;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.RefreshTokenRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.JwtIssuerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/auth/review-login end to end with review login enabled: the
// credential gate, the shared token issuance, the post-auth allowlist, and
// the endpoint's own rate-limit bucket (rate limiting is on in this context,
// so every request that is not about rate limits uses a fresh client IP).
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestGoogleIdTokens.LocalKeyVerifier.class)
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "auth.google.mobile-audiences=" + TestGoogleIdTokens.WEB_CLIENT,
    "itba.api.use-fake=true",
    "rate-limit.enabled=true",
    "rate-limit.trust-forwarded-for=true",
    // Mirrors application.yml: the generic auth bucket excludes review-login...
    "rate-limit.rules.auth.paths[0]=/v1/auth/**",
    "rate-limit.rules.auth.exclude-paths[0]=/v1/auth/me",
    "rate-limit.rules.auth.exclude-paths[1]=/v1/auth/review-login",
    "rate-limit.rules.auth.capacity=2",
    "rate-limit.rules.auth.period=1m",
    // ...which has its own strict bucket.
    "rate-limit.rules.auth-review-login.paths[0]=/v1/auth/review-login",
    "rate-limit.rules.auth-review-login.capacity=10",
    "rate-limit.rules.auth-review-login.period=1m"
})
class ReviewLoginIT {

    static final String REVIEW_EMAIL = "appreview@example.com";
    static final String PASSWORD = "correct horse battery staple";

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        // Configured with odd casing/whitespace on purpose: it is normalized.
        r.add("auth.review-login.email", () -> "  AppReview@Example.com ");
        r.add("auth.review-login.password-hash", () -> new BCryptPasswordEncoder(4).encode(PASSWORD));
    }

    private static final AtomicInteger IP = new AtomicInteger(1);

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired RefreshTokenRepository refreshTokens;
    @Autowired JwtIssuerService jwtIssuer;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
    }

    private static String freshIp() {
        int n = IP.getAndIncrement();
        return "198.51." + (100 + n / 250) + "." + (1 + n % 250);
    }

    private ResultActions reviewLoginFrom(String ip, Map<String, ?> body) throws Exception {
        return mvc.perform(post("/v1/auth/review-login")
            .header("X-Forwarded-For", ip)
            .contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(body)));
    }

    private ResultActions reviewLogin(String email, String password) throws Exception {
        var body = new HashMap<String, Object>();
        body.put("email", email);
        body.put("password", password);
        body.put("deviceName", "iPhone 15 (review)");
        return reviewLoginFrom(freshIp(), body);
    }

    private JsonNode loginOk() throws Exception {
        return json.readTree(reviewLogin(REVIEW_EMAIL, PASSWORD)
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString());
    }

    private ResultActions getWithBearer(String path, String accessToken) throws Exception {
        return mvc.perform(get(path)
            .header("X-Forwarded-For", freshIp())
            .header("Authorization", "Bearer " + accessToken));
    }

    @Test
    void successReturnsTheMobileTokenShapeAndAPlainUser() throws Exception {
        var body = json.readTree(reviewLogin(REVIEW_EMAIL, PASSWORD)
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.accessToken").isString())
            .andExpect(jsonPath("$.accessTokenExpiresAt").isString())
            .andExpect(jsonPath("$.refreshToken").isString())
            .andExpect(jsonPath("$.refreshTokenExpiresAt").isString())
            .andExpect(jsonPath("$.user.email").value(REVIEW_EMAIL))
            .andExpect(jsonPath("$.user.name").value("App Review"))
            .andExpect(jsonPath("$.user.role").value("user"))
            .andExpect(jsonPath("$.user.moderator").value(false))
            .andReturn().getResponse().getContentAsString());

        // JIT-provisioned, onboarding left to the reviewer.
        var user = users.findByEmail(REVIEW_EMAIL).orElseThrow();
        assertThat(user.getCareer()).isNull();
        assertThat(user.getPlan()).isNull();
        assertThat(user.getFileNumber()).isNull();
        assertThat(refreshTokens.findAll()).singleElement()
            .satisfies(t -> assertThat(t.getDeviceName()).isEqualTo("iPhone 15 (review)"));

        String access = body.get("accessToken").asText();
        getWithBearer("/v1/auth/me", access)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(user.getId().toString()))
            .andExpect(jsonPath("$.role").value("user"))
            .andExpect(jsonPath("$.moderator").value(false));
        // Not STAFF, not MODERATOR.
        getWithBearer("/v1/staff", access).andExpect(status().isForbidden());
        getWithBearer("/v1/staff/proposals", access).andExpect(status().isForbidden());
    }

    @Test
    void emailMatchIsCaseInsensitiveAndRepeatedLoginsReuseTheUser() throws Exception {
        reviewLogin("  APPREVIEW@example.COM", PASSWORD).andExpect(status().isOk());
        loginOk();
        assertThat(users.count()).isEqualTo(1);
        assertThat(refreshTokens.count()).isEqualTo(2);
    }

    @Test
    void wrongPasswordIsRejected() throws Exception {
        reviewLogin(REVIEW_EMAIL, "wrong password")
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_credentials"));
        assertThat(users.count()).isZero();
        assertThat(refreshTokens.count()).isZero();
    }

    @Test
    void anyOtherEmailIsRejectedEvenWithTheRightPassword() throws Exception {
        for (String email : new String[] {"alice@itba.edu.ar", "appreview@example.org", "someone@gmail.com"}) {
            reviewLogin(email, PASSWORD)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("invalid_credentials"));
        }
        assertThat(users.count()).isZero();
    }

    @Test
    void missingOrBlankFieldsAreInvalidCredentials() throws Exception {
        reviewLogin(REVIEW_EMAIL, null).andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_credentials"));
        reviewLogin(null, PASSWORD).andExpect(status().isUnauthorized());
        reviewLogin(REVIEW_EMAIL, "").andExpect(status().isUnauthorized());
        reviewLogin(REVIEW_EMAIL, "x".repeat(100)).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/review-login").header("X-Forwarded-For", freshIp()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void allowlistAdmitsTheReviewEmailButNothingElse() throws Exception {
        String reviewAccess = loginOk().get("accessToken").asText();
        getWithBearer("/v1/auth/me", reviewAccess).andExpect(status().isOk());

        // A validly signed JWT for any other non-allowlisted address is still denied.
        for (String email : new String[] {"mallory@gmail.com", "appreview@example.org", "x.appreview@example.com"}) {
            String other = jwtIssuer.issueMobileAccess(new User(UUID.randomUUID(), email, "Other")).token();
            getWithBearer("/v1/auth/me", other).andExpect(status().isForbidden());
        }
    }

    @Test
    void googleLoginWithTheReviewEmailIsStillRejected() throws Exception {
        mvc.perform(post("/v1/auth/google/mobile")
                .header("X-Forwarded-For", freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("idToken", TestGoogleIdTokens.token(REVIEW_EMAIL)))))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    @Test
    void refreshAndLogoutWorkUnchanged() throws Exception {
        var login = loginOk();
        String refresh = login.get("refreshToken").asText();

        var rotated = json.readTree(mvc.perform(post("/v1/auth/refresh")
                .header("X-Forwarded-For", freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", refresh))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.email").value(REVIEW_EMAIL))
            .andExpect(jsonPath("$.user.role").value("user"))
            .andReturn().getResponse().getContentAsString());
        String next = rotated.get("refreshToken").asText();
        assertThat(next).isNotEqualTo(refresh);
        getWithBearer("/v1/auth/me", rotated.get("accessToken").asText()).andExpect(status().isOk());

        mvc.perform(post("/v1/auth/logout")
                .header("X-Forwarded-For", freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", next))))
            .andExpect(status().isNoContent());
        mvc.perform(post("/v1/auth/refresh")
                .header("X-Forwarded-For", freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", next))))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void reviewAccountCannotCreateApiKeys() throws Exception {
        String access = loginOk().get("accessToken").asText();
        mvc.perform(post("/v1/auth/api-keys")
                .header("X-Forwarded-For", freshIp())
                .header("Authorization", "Bearer " + access)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("name", "script"))))
            .andExpect(status().isForbidden());
    }

    @Test
    void staleBearerTokenIsIgnored() throws Exception {
        mvc.perform(post("/v1/auth/review-login")
                .header("X-Forwarded-For", freshIp())
                .header("Authorization", "Bearer not-a-valid-jwt")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", REVIEW_EMAIL, "password", PASSWORD))))
            .andExpect(status().isOk());
    }

    @Test
    void hasItsOwnStrictRateLimitBucket() throws Exception {
        String ip = "203.0.113.50";
        var wrong = Map.of("email", REVIEW_EMAIL, "password", "guess");
        // 10 attempts go through even though the generic auth bucket holds 2.
        for (int i = 0; i < 10; i++) {
            reviewLoginFrom(ip, wrong).andExpect(status().isUnauthorized());
        }
        reviewLoginFrom(ip, wrong)
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.error").value("TooManyRequests"));
        // Even the right password is throttled from that IP now...
        reviewLoginFrom(ip, Map.of("email", REVIEW_EMAIL, "password", PASSWORD))
            .andExpect(status().isTooManyRequests());
        // ...while other clients are unaffected.
        reviewLoginFrom("203.0.113.51", Map.of("email", REVIEW_EMAIL, "password", PASSWORD))
            .andExpect(status().isOk());
    }
}
