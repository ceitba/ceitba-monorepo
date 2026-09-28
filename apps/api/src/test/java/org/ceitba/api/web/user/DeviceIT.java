package org.ceitba.api.web.user;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.user.DeviceService;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// /v1/me/devices: FCM token registry. Upsert keyed by token, reassignment
// between accounts, idempotent delete that never touches other users' rows,
// and the per-user cap.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
class DeviceIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    // Shaped like a real FCM token (instance id ':' base64url payload), PII-free.
    private static final String TOKEN = "fAk3InstanceId:APA91bFakeFcmToken_payload-0123456789";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;

    User alice;
    User bob;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        bob   = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder req, User u) {
        return req.with(jwt().jwt(t -> t.claim("email", u.getEmail()).claim("name", u.getName()))
            .authorities(new SimpleGrantedAuthority("ROLE_USER")));
    }

    private ResultActions register(User u, String token, String platform, String appVersion) throws Exception {
        String version = appVersion == null ? "null" : "\"" + appVersion + "\"";
        return mvc.perform(as(put("/v1/me/devices"), u)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"token":"%s","platform":"%s","appVersion":%s}
                """.formatted(token, platform, version)));
    }

    private UUID ownerOf(String token) {
        return jdbc.query("SELECT user_id FROM public.user_devices WHERE token = ?",
            rs -> rs.next() ? rs.getObject(1, UUID.class) : null, token);
    }

    private int deviceCount() {
        return jdbc.queryForObject("SELECT count(*) FROM public.user_devices", Integer.class);
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(put("/v1/me/devices").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"t\",\"platform\":\"ios\"}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(delete("/v1/me/devices/t")).andExpect(status().isUnauthorized());
    }

    @Test
    void registerStoresTheDeviceAndListsIt() throws Exception {
        register(alice, TOKEN, "IOS", "2.0.0")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").value(TOKEN))
            .andExpect(jsonPath("$.platform").value("ios"))
            .andExpect(jsonPath("$.appVersion").value("2.0.0"))
            .andExpect(jsonPath("$.createdAt").isNotEmpty())
            .andExpect(jsonPath("$.lastSeenAt").isNotEmpty());

        mvc.perform(as(get("/v1/me/devices"), alice))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].token").value(TOKEN));
        mvc.perform(as(get("/v1/me/devices"), bob))
            .andExpect(jsonPath("$.length()").value(0));
        assertThat(ownerOf(TOKEN)).isEqualTo(alice.getId());
    }

    @Test
    void reRegisteringIsAnUpsertThatKeepsCreatedAt() throws Exception {
        register(alice, TOKEN, "android", "1.0.0").andExpect(status().isOk());
        jdbc.update("UPDATE public.user_devices SET created_at = now() - interval '5 days', "
            + "last_seen_at = now() - interval '5 days' WHERE token = ?", TOKEN);
        var before = jdbc.queryForObject(
            "SELECT created_at FROM public.user_devices WHERE token = ?", Timestamp.class, TOKEN);

        register(alice, TOKEN, "android", null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.appVersion").value(nullValue()));

        assertThat(deviceCount()).isEqualTo(1);
        var row = jdbc.queryForMap(
            "SELECT created_at, last_seen_at FROM public.user_devices WHERE token = ?", TOKEN);
        assertThat(row.get("created_at")).isEqualTo(before);
        assertThat(((Timestamp) row.get("last_seen_at")).toInstant())
            .isAfter(Instant.now().minus(1, ChronoUnit.HOURS));
    }

    @Test
    void aTokenRegisteredByAnotherUserMovesToThem() throws Exception {
        register(alice, TOKEN, "ios", "1.0.0").andExpect(status().isOk());

        register(bob, TOKEN, "ios", "1.0.1").andExpect(status().isOk());

        assertThat(deviceCount()).isEqualTo(1);
        assertThat(ownerOf(TOKEN)).isEqualTo(bob.getId());
        mvc.perform(as(get("/v1/me/devices"), alice))
            .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void invalidRequestsAreRejected() throws Exception {
        register(alice, TOKEN, "windows", null).andExpect(status().isBadRequest());
        register(alice, "", "ios", null).andExpect(status().isBadRequest());
        register(alice, "has spaces/and slashes", "ios", null).andExpect(status().isBadRequest());
        register(alice, TOKEN, "ios", "x".repeat(33)).andExpect(status().isBadRequest());
        register(alice, "t".repeat(1025), "ios", null).andExpect(status().isBadRequest());
        mvc.perform(as(put("/v1/me/devices"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + TOKEN + "\"}"))
            .andExpect(status().isBadRequest());
        assertThat(deviceCount()).isZero();

        // The longest token the column holds is accepted.
        register(alice, "t".repeat(1024), "ios", null).andExpect(status().isOk());
        assertThat(deviceCount()).isEqualTo(1);
    }

    @Test
    void deleteRemovesOnlyTheCallersToken() throws Exception {
        register(alice, TOKEN, "ios", null).andExpect(status().isOk());
        register(bob, "bob-token", "android", null).andExpect(status().isOk());

        // Someone else's token: 204, untouched.
        mvc.perform(as(delete("/v1/me/devices/{token}", "bob-token"), alice))
            .andExpect(status().isNoContent());
        assertThat(ownerOf("bob-token")).isEqualTo(bob.getId());

        mvc.perform(as(delete("/v1/me/devices/{token}", TOKEN), alice))
            .andExpect(status().isNoContent());
        assertThat(ownerOf(TOKEN)).isNull();

        // Idempotent (logout retry).
        mvc.perform(as(delete("/v1/me/devices/{token}", TOKEN), alice))
            .andExpect(status().isNoContent());
    }

    @Test
    void registrationsBeyondTheCapDropTheLeastRecentlySeen() throws Exception {
        for (int i = 0; i < DeviceService.MAX_DEVICES_PER_USER; i++) {
            jdbc.update("""
                INSERT INTO public.user_devices (token, user_id, platform, created_at, last_seen_at)
                VALUES (?, ?, 'android', now() - make_interval(days => ?), now() - make_interval(days => ?))
                """, "old-" + i, alice.getId(), 30 - i, 30 - i);
        }
        register(bob, "bob-token", "ios", null).andExpect(status().isOk());

        register(alice, TOKEN, "ios", null).andExpect(status().isOk());

        var aliceTokens = jdbc.queryForList(
            "SELECT token FROM public.user_devices WHERE user_id = ?", String.class, alice.getId());
        assertThat(aliceTokens).hasSize(DeviceService.MAX_DEVICES_PER_USER)
            .contains(TOKEN)
            .doesNotContain("old-0");
        assertThat(ownerOf("bob-token")).isEqualTo(bob.getId());
    }
}
