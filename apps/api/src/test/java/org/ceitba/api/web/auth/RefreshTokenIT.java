package org.ceitba.api.web.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.RefreshToken;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.RefreshTokenRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.auth.RefreshTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/auth/refresh rotation + reuse detection (and its grace window for
// lost responses) + allowlist re-check, and
// the logout / logout-all revocations.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
class RefreshTokenIT {

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
    @Autowired RefreshTokenService refreshTokenService;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txManager;

    User alice;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
    }

    private String newFamily(User user) {
        return refreshTokenService.issueNewFamily(user.getId(), "test-device").token();
    }

    private ResultActions refresh(String token) throws Exception {
        return mvc.perform(post("/v1/auth/refresh")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("refreshToken", token))));
    }

    private JsonNode ok(ResultActions r) throws Exception {
        return json.readTree(r.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void refreshRotatesTheToken() throws Exception {
        String t1 = newFamily(alice);

        JsonNode body = ok(refresh(t1));
        String t2 = body.get("refreshToken").asText();

        assertThat(t2).isNotEqualTo(t1);
        assertThat(body.get("accessToken").asText()).isNotBlank();
        assertThat(body.at("/user/email").asText()).isEqualTo("alice@itba.edu.ar");

        var rows = refreshTokens.findAll();
        assertThat(rows).hasSize(2);
        assertThat(rows).extracting(RefreshToken::getFamilyId).containsOnly(rows.get(0).getFamilyId());
        var old = rows.stream().filter(RefreshToken::isRevoked).findFirst().orElseThrow();
        var current = rows.stream().filter(r -> !r.isRevoked()).findFirst().orElseThrow();
        assertThat(old.getReplacedBy()).isEqualTo(current.getId());
        assertThat(current.getDeviceName()).isEqualTo("test-device");

        // The successor keeps working.
        ok(refresh(t2));
    }

    // Moves every rotation of the caller's tokens outside the grace window.
    private void ageRotations() {
        jdbc.update("UPDATE public.refresh_tokens SET revoked_at = revoked_at - INTERVAL '10 minutes' "
            + "WHERE revoked_at IS NOT NULL");
    }

    @Test
    void reusingARotatedTokenAfterTheGraceWindowRevokesTheWholeFamily() throws Exception {
        String t1 = newFamily(alice);
        String t2 = ok(refresh(t1)).get("refreshToken").asText();
        ageRotations();

        refresh(t1)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_token"));

        // The legitimate holder of t2 is logged out too.
        refresh(t2).andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
    }

    @Test
    void reusingARotatedTokenWhoseSuccessorWasUsedRevokesTheWholeFamily() throws Exception {
        String t1 = newFamily(alice);
        String t2 = ok(refresh(t1)).get("refreshToken").asText();
        String t3 = ok(refresh(t2)).get("refreshToken").asText();

        // Still inside the grace window, but t2 was used: that is theft.
        refresh(t1).andExpect(status().isUnauthorized());

        refresh(t3).andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
    }

    @Test
    void retryWithinGraceWindowAfterALostResponseIssuesANewSuccessor() throws Exception {
        String t1 = newFamily(alice);
        String lost = ok(refresh(t1)).get("refreshToken").asText(); // never reached the client

        String t3 = ok(refresh(t1)).get("refreshToken").asText();

        assertThat(t3).isNotEqualTo(lost);
        var rows = refreshTokens.findAll();
        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(RefreshToken::getFamilyId).containsOnly(rows.get(0).getFamilyId());
        assertThat(rows).filteredOn(r -> !r.isRevoked()).hasSize(1);
        var live = rows.stream().filter(r -> !r.isRevoked()).findFirst().orElseThrow();
        // Both the retried token and the unused successor now point at t3.
        assertThat(rows).filteredOn(RefreshToken::isRevoked)
            .extracting(RefreshToken::getReplacedBy).containsOnly(live.getId());

        // The session goes on.
        ok(refresh(t3));
    }

    @Test
    void theReplacedSuccessorCountsAsReuseOnceTheNewOneWasUsed() throws Exception {
        String t1 = newFamily(alice);
        String lost = ok(refresh(t1)).get("refreshToken").asText();
        String t3 = ok(refresh(t1)).get("refreshToken").asText();
        String t4 = ok(refresh(t3)).get("refreshToken").asText();

        refresh(lost).andExpect(status().isUnauthorized());

        refresh(t4).andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
    }

    @Test
    void reuseDoesNotTouchOtherFamilies() throws Exception {
        String a = newFamily(alice);
        String b = newFamily(alice);
        ok(refresh(a));
        ageRotations();
        refresh(a).andExpect(status().isUnauthorized());

        ok(refresh(b));
    }

    @Test
    void userRemovedFromAllowlistLosesTheFamily() throws Exception {
        // Seeded directly: this user could only have a token if the allowlist
        // changed after they logged in.
        var mallory = users.save(new User(UUID.randomUUID(), "mallory@gmail.com", "Mallory"));
        String t = newFamily(mallory);

        refresh(t)
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("unauthorized"));
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
        refresh(t).andExpect(status().isUnauthorized());
    }

    @Test
    void unknownTokenIsRejected() throws Exception {
        refresh("not-a-real-token")
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_token"));
    }

    @Test
    void expiredTokenIsRejected() throws Exception {
        String raw = "expired-raw-token";
        refreshTokens.save(new RefreshToken(UUID.randomUUID(), alice.getId(), UUID.randomUUID(),
            sha256(raw), null, OffsetDateTime.now().minusMinutes(1)));

        refresh(raw).andExpect(status().isUnauthorized());
    }

    @Test
    void refreshIgnoresAnExpiredBearerHeader() throws Exception {
        String t = newFamily(alice);
        mvc.perform(post("/v1/auth/refresh")
                .header("Authorization", "Bearer expired.or.garbage")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", t))))
            .andExpect(status().isOk());
    }

    @Test
    void logoutWithRefreshTokenRevokesItsFamily() throws Exception {
        String t1 = newFamily(alice);
        String t2 = ok(refresh(t1)).get("refreshToken").asText();
        String other = newFamily(alice);

        mvc.perform(post("/v1/auth/logout")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", t2))))
            .andExpect(status().isNoContent());

        refresh(t2).andExpect(status().isUnauthorized());
        ok(refresh(other));
    }

    @Test
    void logoutWithoutBodyStillWorks() throws Exception {
        mvc.perform(post("/v1/auth/logout")).andExpect(status().isNoContent());
        mvc.perform(post("/v1/auth/logout")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", "unknown"))))
            .andExpect(status().isNoContent());
    }

    @Test
    void logoutWithANonJsonBodyStillClearsTheCookie() throws Exception {
        // navigator.sendBeacon posts text/plain; a form posts urlencoded.
        mvc.perform(post("/v1/auth/logout")
                .contentType(MediaType.TEXT_PLAIN)
                .content("bye"))
            .andExpect(status().isNoContent())
            .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        mvc.perform(post("/v1/auth/logout")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .content("a=b"))
            .andExpect(status().isNoContent());
    }

    @Test
    void logoutAllRevokesEveryFamilyOfTheCaller() throws Exception {
        String a = newFamily(alice);
        String b = newFamily(alice);
        var bob = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        String bobs = newFamily(bob);

        mvc.perform(post("/v1/auth/logout-all")
                .with(jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar"))
                    .authorities(new SimpleGrantedAuthority("ROLE_USER"))))
            .andExpect(status().isNoContent());

        refresh(a).andExpect(status().isUnauthorized());
        refresh(b).andExpect(status().isUnauthorized());
        ok(refresh(bobs));
    }

    @Test
    void logoutAllRequiresAuthentication() throws Exception {
        mvc.perform(post("/v1/auth/logout-all")).andExpect(status().isUnauthorized());
    }

    // Per-family serialization: a revocation that starts while a rotation of
    // the same family is still uncommitted must wait for it and then revoke
    // the successor too. Without the family lock the revocation's UPDATE
    // cannot see the uncommitted successor row, which survives.
    @Test
    void logoutDuringAnUncommittedRotationAlsoRevokesTheSuccessor() throws Exception {
        String t1 = newFamily(alice);
        String successor = rotateWhileRevoking(t1, token -> refreshTokenService.revokeFamilyOf(token));

        refresh(successor).andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
    }

    @Test
    void logoutAllDuringAnUncommittedRotationAlsoRevokesTheSuccessor() throws Exception {
        String t1 = newFamily(alice);
        String successor = rotateWhileRevoking(t1, token -> refreshTokenService.revokeAllForUser(alice.getId()));

        refresh(successor).andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findAll()).allMatch(RefreshToken::isRevoked);
    }

    // Rotates `token` in a transaction held open until `revoke` (run on
    // another thread) has had time to block on the family lock, then commits
    // and returns the successor once the revocation has finished too.
    private String rotateWhileRevoking(String token, Consumer<String> revoke) throws Exception {
        var tx = new TransactionTemplate(txManager);
        var rotated = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<String> rotation = pool.submit(() -> tx.execute(status -> {
                String next = refreshTokenService.rotate(token).refreshToken().token();
                rotated.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return next;
            }));
            assertThat(rotated.await(10, TimeUnit.SECONDS)).isTrue();

            Future<?> revocation = pool.submit(() -> revoke.accept(token));
            assertThatThrownBy(() -> revocation.get(500, TimeUnit.MILLISECONDS))
                .as("revocation must wait for the in-flight rotation of the family")
                .isInstanceOf(TimeoutException.class);

            release.countDown();
            String successor = rotation.get(10, TimeUnit.SECONDS);
            revocation.get(10, TimeUnit.SECONDS);
            return successor;
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private static String sha256(String raw) throws Exception {
        return HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
    }
}
