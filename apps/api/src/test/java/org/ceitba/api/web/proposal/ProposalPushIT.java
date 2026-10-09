package org.ceitba.api.web.proposal;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.support.AsyncWork;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.push.FakePushGateway;
import org.ceitba.api.service.push.FakePushGatewayConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Moderation (B5) -> ProposalStatusChangedEvent -> push to the author's
// devices (B4b), after commit, through the real FcmPushNotificationService
// against an in-memory gateway.
@SpringBootTest
@AutoConfigureMockMvc
@Import(FakePushGatewayConfig.class)
class ProposalPushIT {

    private static final Duration WAIT = Duration.ofSeconds(10);
    private static final String AUTHOR = "autor@itba.edu.ar";
    private static final String OTHER = "otro@itba.edu.ar";
    private static final String MOD = "mod@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ObjectMapper json;
    @Autowired FakePushGateway gateway;
    @Autowired ApplicationContext context;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        User author = users.save(new User(UUID.randomUUID(), AUTHOR, "Autor"));
        User other = users.save(new User(UUID.randomUUID(), OTHER, "Otro"));
        users.save(new User(UUID.randomUUID(), MOD, "Moderador"));
        device("author-phone", author);
        device("author-tablet", author);
        device("other-phone", other);
        gateway.reset();
    }

    private void device(String token, User u) {
        jdbc.update("INSERT INTO public.user_devices (token, user_id, platform) VALUES (?, ?, 'ios')",
            token, u.getId());
    }

    private static RequestPostProcessor as(String email, String... roles) {
        GrantedAuthority[] authorities = Arrays.stream(roles)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    private static RequestPostProcessor mod() {
        return as(MOD, "USER", "MODERATOR");
    }

    private String create(String title) throws Exception {
        String res = mvc.perform(post("/v1/proposals").with(as(AUTHOR, "USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\",\"description\":\"d\",\"topic\":\"CEITBA\"}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(res).get("id").asText();
    }

    private void awaitCalls(int n) {
        await().atMost(WAIT).until(() -> gateway.calls().size() >= n);
    }

    private void assertCallsStay(int n) {
        AsyncWork.awaitIdle(context);
        assertThat(gateway.calls()).hasSize(n);
    }

    @Test
    void creatingAProposalDoesNotPush() throws Exception {
        create("Más microondas");
        assertCallsStay(0);
    }

    @Test
    void approvalPushesToTheAuthorsDevicesOnly() throws Exception {
        String id = create("Más microondas");

        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());

        awaitCalls(1);
        var call = gateway.calls().get(0);
        assertThat(call.tokens()).containsExactlyInAnyOrder("author-phone", "author-tablet");
        assertThat(call.message().title()).isEqualTo("Tu propuesta fue aprobada");
        assertThat(call.message().body()).isEqualTo("Más microondas");
        assertThat(call.message().data()).containsEntry("type", "proposal").containsEntry("id", id);
        assertCallsStay(1);
    }

    @Test
    void rejectionAndLifecycleChangesPushAndNoOpsDoNot() throws Exception {
        String id = create("Bicicleteros");
        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        awaitCalls(1);

        mvc.perform(patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"ACEPTADO\"}"))
            .andExpect(status().isOk());
        awaitCalls(2);
        assertThat(gateway.calls().get(1).message().title()).isEqualTo("Tu propuesta fue aceptada");

        // Same lifecycle again: no event, no push.
        mvc.perform(patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"ACEPTADO\"}"))
            .andExpect(status().isOk());
        assertCallsStay(2);

        mvc.perform(post("/v1/staff/proposals/" + id + "/reject").with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"duplicada\"}"))
            .andExpect(status().isOk());
        awaitCalls(3);
        assertThat(gateway.calls().get(2).message().title()).isEqualTo("Tu propuesta fue rechazada");
        assertThat(gateway.calls().get(2).tokens()).containsExactlyInAnyOrder("author-phone", "author-tablet");
    }

    @Test
    void aFailedModerationSendsNothing() throws Exception {
        String id = create("Algo");
        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        awaitCalls(1);

        // Approving twice is a 409: the transaction rolls back, nothing is sent.
        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isConflict());
        assertCallsStay(1);
    }

    @Test
    void aProposalWhoseAuthorDeletedTheirAccountDoesNotPush() throws Exception {
        String id = create("Huérfana");
        jdbc.update("UPDATE public.proposal SET author_id = NULL WHERE id = ?::uuid", id);

        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        assertCallsStay(0);
    }
}
