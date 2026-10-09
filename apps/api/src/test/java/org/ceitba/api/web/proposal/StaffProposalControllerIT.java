package org.ceitba.api.web.proposal;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.proposal.ProposalStatusChangedEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.Arrays;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// /v1/staff/proposals/** is open to MODERATOR (not only STAFF), closed to
// plain users, and publishes ProposalStatusChangedEvent on every change.
@SpringBootTest
@AutoConfigureMockMvc
@RecordApplicationEvents
class StaffProposalControllerIT {

    private static final String AUTHOR = "autor@itba.edu.ar";
    private static final String USER = "user@itba.edu.ar";
    private static final String MOD = "mod@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ObjectMapper json;
    @Autowired ApplicationEvents events;

    private User author;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        author = users.save(new User(UUID.randomUUID(), AUTHOR, "Autor"));
        users.save(new User(UUID.randomUUID(), MOD, "Moderador"));
    }

    private static RequestPostProcessor as(String email, String... roles) {
        GrantedAuthority[] authorities = Arrays.stream(roles)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    private static RequestPostProcessor user() {
        return as(USER, "USER");
    }

    // A moderator grant without STAFF.
    private static RequestPostProcessor mod() {
        return as(MOD, "USER", "MODERATOR");
    }

    private String create(String title) throws Exception {
        String res = mvc.perform(post("/v1/proposals").with(as(AUTHOR, "USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\",\"description\":\"d\",\"topic\":\"CEITBA\"}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return json.readTree(res).get("id").asText();
    }

    @Test
    void plainUserGets403Everywhere() throws Exception {
        String id = create("Algo");
        mvc.perform(get("/v1/staff/proposals").with(user())).andExpect(status().isForbidden());
        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(user())).andExpect(status().isForbidden());
        mvc.perform(post("/v1/staff/proposals/" + id + "/reject").with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"no\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(patch("/v1/staff/proposals/" + id).with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"CERRADO\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/staff/proposals/" + id + "/comments/" + UUID.randomUUID()).with(user()))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/staff/proposals")).andExpect(status().isUnauthorized());

        assertThat(jdbc.queryForObject("SELECT status FROM public.proposal WHERE id = ?::uuid", String.class, id))
            .isEqualTo("PENDING");
        assertThat(events.stream(ProposalStatusChangedEvent.class)).isEmpty();
    }

    @Test
    void moderatorOutsideTheAllowlistIsRejected() throws Exception {
        mvc.perform(get("/v1/staff/proposals").with(as("mod@gmail.com", "USER", "MODERATOR")))
            .andExpect(status().isForbidden());
    }

    @Test
    void moderatorIsNotStaffElsewhere() throws Exception {
        mvc.perform(get("/v1/staff/moderators").with(mod())).andExpect(status().isForbidden());
    }

    @Test
    void moderatorWorksTheQueueOldestFirst() throws Exception {
        String first = create("Primera");
        String second = create("Segunda");

        String queue = mvc.perform(get("/v1/staff/proposals").with(mod()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(2))
            .andExpect(jsonPath("$.data[0].id").value(first))
            .andExpect(jsonPath("$.data[1].id").value(second))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(queue).doesNotContain(author.getId().toString()).doesNotContain(AUTHOR);

        mvc.perform(post("/v1/staff/proposals/" + first + "/approve").with(mod()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("APPROVED"))
            .andExpect(jsonPath("$.moderatedAt").isString());
        mvc.perform(post("/v1/staff/proposals/" + first + "/approve").with(mod()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("InvalidState"));

        mvc.perform(post("/v1/staff/proposals/" + second + "/reject").with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/staff/proposals/" + second + "/reject").with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Duplicada\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("REJECTED"))
            .andExpect(jsonPath("$.rejectionReason").value("Duplicada"));

        mvc.perform(get("/v1/staff/proposals").with(mod())).andExpect(jsonPath("$.data", hasSize(0)));
        mvc.perform(get("/v1/staff/proposals?status=REJECTED").with(mod()))
            .andExpect(jsonPath("$.data[0].id").value(second));
        mvc.perform(get("/v1/staff/proposals?status=NOPE").with(mod())).andExpect(status().isBadRequest());

        // The author sees the reason; the moderator id is recorded but never shown.
        mvc.perform(get("/v1/me/proposals").with(as(AUTHOR, "USER")))
            .andExpect(jsonPath("$.data[0].rejectionReason").value("Duplicada"));
        var modId = users.findByEmail(MOD).orElseThrow().getId();
        assertThat(jdbc.queryForObject("SELECT moderated_by FROM public.proposal WHERE id = ?::uuid",
            UUID.class, second)).isEqualTo(modId);

        assertThat(events.stream(ProposalStatusChangedEvent.class)).containsExactly(
            new ProposalStatusChangedEvent(UUID.fromString(first), author.getId(), "APPROVED"),
            new ProposalStatusChangedEvent(UUID.fromString(second), author.getId(), "REJECTED"));
    }

    @Test
    void lifecycleAndCommentModeration() throws Exception {
        String id = create("Con ciclo");
        mvc.perform(patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"ACEPTADO\"}"))
            .andExpect(status().isConflict());

        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        mvc.perform(patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"aceptado\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.lifecycle").value("ACEPTADO"));
        mvc.perform(patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"INVALIDO\"}"))
            .andExpect(status().isBadRequest());

        String comment = json.readTree(mvc.perform(post("/v1/proposals/" + id + "/comments").with(user())
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"spam\"}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).get("id").asText();

        mvc.perform(delete("/v1/staff/proposals/" + id + "/comments/" + comment).with(mod()))
            .andExpect(status().isNoContent());
        mvc.perform(delete("/v1/staff/proposals/" + id + "/comments/" + UUID.randomUUID()).with(mod()))
            .andExpect(status().isNotFound());
        mvc.perform(get("/v1/proposals/" + id).with(user()))
            .andExpect(jsonPath("$.commentCount").value(0))
            .andExpect(jsonPath("$.lifecycle").value("ACEPTADO"));

        assertThat(events.stream(ProposalStatusChangedEvent.class))
            .extracting(ProposalStatusChangedEvent::newStatus)
            .containsExactly("APPROVED", "ACEPTADO");
    }

    @Test
    void unknownProposalIs404() throws Exception {
        mvc.perform(post("/v1/staff/proposals/" + UUID.randomUUID() + "/approve").with(mod()))
            .andExpect(status().isNotFound());
    }
}
