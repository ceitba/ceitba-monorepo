package org.ceitba.api.web.staff;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.push.FakePushGateway;
import org.ceitba.api.service.push.FakePushGatewayConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/staff/push/broadcast: STAFF only, reaches every registered device.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(FakePushGatewayConfig.class)
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
class PushBroadcastIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final Duration QUIET = Duration.ofMillis(700);
    private static final String BODY = """
        {"title":"CEITBA","body":"Mañana no hay clases","data":{"type":"announcement","id":"42"}}
        """;

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired FakePushGateway gateway;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        gateway.reset();
        User alice = users.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
        User bob   = users.save(new User(UUID.randomUUID(), "bob@itba.edu.ar", "Bob"));
        jdbc.update("INSERT INTO public.user_devices (token, user_id, platform) VALUES ('a-1', ?, 'ios')", alice.getId());
        jdbc.update("INSERT INTO public.user_devices (token, user_id, platform) VALUES ('b-1', ?, 'android')", bob.getId());
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar").claim("name", "Boss"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "alice@itba.edu.ar").claim("name", "Alice"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private void assertNothingSent() {
        await().during(QUIET).atMost(QUIET.plusSeconds(2)).until(() -> gateway.calls().isEmpty());
    }

    @Test
    void anonymousIsUnauthorized() throws Exception {
        mvc.perform(post("/v1/staff/push/broadcast").contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isUnauthorized());
        assertNothingSent();
    }

    @Test
    void regularUserIsForbidden() throws Exception {
        mvc.perform(post("/v1/staff/push/broadcast").with(user())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isForbidden());
        assertNothingSent();
    }

    @Test
    void staffBroadcastReachesEveryDevice() throws Exception {
        mvc.perform(post("/v1/staff/push/broadcast").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
            .andExpect(status().isAccepted());

        await().atMost(Duration.ofSeconds(10)).until(() -> !gateway.calls().isEmpty());
        var call = gateway.calls().get(0);
        assertThat(call.tokens()).containsExactlyInAnyOrder("a-1", "b-1");
        assertThat(call.message().title()).isEqualTo("CEITBA");
        assertThat(call.message().body()).isEqualTo("Mañana no hay clases");
        assertThat(call.message().data()).containsEntry("type", "announcement").containsEntry("id", "42");
    }

    @Test
    void invalidBroadcastsAreRejected() throws Exception {
        for (String body : new String[] {
            "{\"title\":\" \",\"body\":\"b\"}",
            "{\"title\":\"t\"}",
            "{\"title\":\"t\",\"body\":\"" + "x".repeat(1001) + "\"}",
            "{\"title\":\"t\",\"body\":\"b\",\"data\":{\"from\":\"x\"}}",
            "{\"title\":\"t\",\"body\":\"b\",\"data\":{\"google.x\":\"x\"}}",
            "{\"title\":\"t\",\"body\":\"b\",\"data\":{\"k\":\"" + "v".repeat(201) + "\"}}"
        }) {
            mvc.perform(post("/v1/staff/push/broadcast").with(staff())
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
        }
        assertNothingSent();
    }
}
