package org.ceitba.api.web.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Student-facing /v1/proposals: visibility of unmoderated proposals, votes
// and comment counters, pseudonymous comments, and that no response ever
// carries a user id, email or name.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "itba.api.use-fake=true"})
class ProposalControllerIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String AUTHOR = "autora@itba.edu.ar";
    private static final String ALICE = "alice@itba.edu.ar";
    private static final String BOB = "bob@itba.edu.ar";
    private static final String MOD = "mod@itba.edu.ar";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired ObjectMapper json;

    private List<User> people;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE public.\"user\" CASCADE");
        people = List.of(
            users.save(new User(UUID.randomUUID(), AUTHOR, "Ana Autora")),
            users.save(new User(UUID.randomUUID(), ALICE, "Alice Pérez")),
            users.save(new User(UUID.randomUUID(), BOB, "Bob Gómez")),
            users.save(new User(UUID.randomUUID(), MOD, "Mora Moderadora")));
    }

    private User user(String email) {
        return people.stream().filter(u -> u.getEmail().equals(email)).findFirst().orElseThrow();
    }

    private static RequestPostProcessor as(String email, String... roles) {
        GrantedAuthority[] authorities = Arrays.stream(roles)
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toArray(GrantedAuthority[]::new);
        return jwt().jwt(t -> t.claim("email", email).claim("name", "Nombre " + email)).authorities(authorities);
    }

    private static RequestPostProcessor mod() {
        return as(MOD, "USER", "MODERATOR");
    }

    private ResultActions perform(MockHttpServletRequestBuilder req, String email, String body) throws Exception {
        req.with(as(email, "USER"));
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
        return mvc.perform(req);
    }

    // Asserts the body leaks no identity of any seeded user.
    private void assertAnonymous(String body) {
        for (User u : people) {
            assertThat(body).doesNotContain(u.getId().toString())
                .doesNotContain(u.getEmail())
                .doesNotContain(u.getName());
        }
        assertThat(body).doesNotContain("authorId").doesNotContain("userId");
    }

    private String create(String email, String title, String topic) throws Exception {
        String res = perform(post("/v1/proposals"), email,
                "{\"title\":\"" + title + "\",\"description\":\"Descripción\",\"topic\":\"" + topic + "\"}")
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return json.readTree(res).get("id").asText();
    }

    private String createApproved(String title, String topic) throws Exception {
        String id = create(AUTHOR, title, topic);
        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        return id;
    }

    @Test
    void anonymousIsRejected() throws Exception {
        mvc.perform(get("/v1/proposals")).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/proposals").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void pendingProposalIsVisibleOnlyToAuthorAndModerators() throws Exception {
        String body = perform(post("/v1/proposals"), AUTHOR,
                "{\"title\":\"Más microondas\",\"description\":\"En el 3er piso\",\"topic\":\"vida_universitaria\"}")
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("PENDING"))
            .andExpect(jsonPath("$.lifecycle").value("ABIERTO"))
            .andExpect(jsonPath("$.topic").value("VIDA_UNIVERSITARIA"))
            .andExpect(jsonPath("$.isMine").value(true))
            .andExpect(jsonPath("$.authorAlias").isString())
            .andExpect(jsonPath("$.attachments", hasSize(0)))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertAnonymous(body);
        String id = json.readTree(body).get("id").asText();

        perform(get("/v1/proposals"), BOB, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data", hasSize(0)))
            .andExpect(jsonPath("$.meta.total").value(0));
        perform(get("/v1/proposals/" + id), BOB, null).andExpect(status().isNotFound());
        perform(get("/v1/proposals/" + id + "/comments"), BOB, null).andExpect(status().isNotFound());
        perform(put("/v1/proposals/" + id + "/vote"), BOB, "{\"value\":\"UP\"}").andExpect(status().isNotFound());

        perform(get("/v1/proposals/" + id), AUTHOR, null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.isMine").value(true));
        perform(put("/v1/proposals/" + id + "/vote"), AUTHOR, "{\"value\":\"UP\"}").andExpect(status().isConflict());
        mvc.perform(get("/v1/proposals/" + id).with(mod()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.isMine").value(false));

        perform(get("/v1/me/proposals"), AUTHOR, null)
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.data[0].status").value("PENDING"));
        perform(get("/v1/me/proposals"), BOB, null).andExpect(jsonPath("$.data", hasSize(0)));

        mvc.perform(post("/v1/staff/proposals/" + id + "/approve").with(mod())).andExpect(status().isOk());
        perform(get("/v1/proposals/" + id), BOB, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("APPROVED"))
            .andExpect(jsonPath("$.isMine").value(false));
    }

    @Test
    void listIsApprovedOnlyNewestFirstPaginatedAndFilterable() throws Exception {
        String first = createApproved("Primera", "EVENTOS");
        String second = createApproved("Segunda", "CURSOS");
        String third = createApproved("Tercera", "EVENTOS");
        create(AUTHOR, "Pendiente", "EVENTOS");

        String page1 = perform(get("/v1/proposals?limit=2"), BOB, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(3))
            .andExpect(jsonPath("$.meta.page").value(1))
            .andExpect(jsonPath("$.meta.limit").value(2))
            .andExpect(jsonPath("$.data", hasSize(2)))
            .andExpect(jsonPath("$.data[0].id").value(third))
            .andExpect(jsonPath("$.data[1].id").value(second))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertAnonymous(page1);
        perform(get("/v1/proposals?limit=2&page=2"), BOB, null)
            .andExpect(jsonPath("$.data", hasSize(1)))
            .andExpect(jsonPath("$.data[0].id").value(first));

        perform(get("/v1/proposals?topic=EVENTOS"), BOB, null)
            .andExpect(jsonPath("$.meta.total").value(2))
            .andExpect(jsonPath("$.data[0].id").value(third))
            .andExpect(jsonPath("$.data[1].id").value(first));
        perform(get("/v1/proposals?topic=NOPE"), BOB, null).andExpect(status().isBadRequest());
    }

    @Test
    void createValidatesInput() throws Exception {
        perform(post("/v1/proposals"), AUTHOR, "{\"title\":\"\",\"description\":\"d\",\"topic\":\"OTROS\"}")
            .andExpect(status().isBadRequest());
        perform(post("/v1/proposals"), AUTHOR, "{\"title\":\"a\\nb\",\"description\":\"d\",\"topic\":\"OTROS\"}")
            .andExpect(status().isBadRequest());
        perform(post("/v1/proposals"), AUTHOR, "{\"title\":\"t\",\"description\":\"d\"}")
            .andExpect(status().isBadRequest());
        perform(post("/v1/proposals"), AUTHOR, "{\"title\":\"t\",\"description\":\"d\",\"topic\":\"DEPORTES\"}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("BadRequest"));
        perform(post("/v1/proposals"), AUTHOR,
                "{\"title\":\"t\",\"description\":\"d\",\"topic\":\"OTROS\",\"attachmentKeys\":[\"proposals/x/y.png\"]}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("ValidationError"));
        perform(get("/v1/me/proposals"), AUTHOR, null).andExpect(jsonPath("$.meta.total").value(0));
    }

    @Test
    void votesKeepCountersAndMyVote() throws Exception {
        String id = createApproved("Votable", "CEITBA");
        String vote = "/v1/proposals/" + id + "/vote";

        perform(put(vote), ALICE, "{\"value\":\"up\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.upCount").value(1))
            .andExpect(jsonPath("$.downCount").value(0))
            .andExpect(jsonPath("$.myVote").value("UP"));
        perform(put(vote), BOB, "{\"value\":\"UP\"}").andExpect(jsonPath("$.upCount").value(2));
        perform(put(vote), ALICE, "{\"value\":\"DOWN\"}")
            .andExpect(jsonPath("$.upCount").value(1))
            .andExpect(jsonPath("$.downCount").value(1));
        perform(put(vote), ALICE, "{\"value\":\"sideways\"}").andExpect(status().isBadRequest());

        perform(get("/v1/proposals/" + id), ALICE, null)
            .andExpect(jsonPath("$.upCount").value(1))
            .andExpect(jsonPath("$.downCount").value(1))
            .andExpect(jsonPath("$.myVote").value("DOWN"));
        perform(get("/v1/proposals"), BOB, null).andExpect(jsonPath("$.data[0].myVote").value("UP"));

        perform(delete(vote), ALICE, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.upCount").value(1))
            .andExpect(jsonPath("$.downCount").value(0));
        perform(delete(vote), ALICE, null).andExpect(jsonPath("$.upCount").value(1));
        perform(get("/v1/proposals/" + id), ALICE, null).andExpect(jsonPath("$.myVote").doesNotExist());

        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.proposal_vote", Integer.class)).isEqualTo(1);

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .patch("/v1/staff/proposals/" + id).with(mod())
                .contentType(MediaType.APPLICATION_JSON).content("{\"lifecycle\":\"CERRADO\"}"))
            .andExpect(status().isOk());
        perform(put(vote), ALICE, "{\"value\":\"UP\"}").andExpect(status().isConflict());
        perform(post("/v1/proposals/" + id + "/comments"), ALICE, "{\"body\":\"tarde\"}")
            .andExpect(status().isConflict());
    }

    @Test
    void commentsArePseudonymousStableAndThreaded() throws Exception {
        String id = createApproved("Charlable", "OTROS");
        String url = "/v1/proposals/" + id + "/comments";

        JsonNode a1 = json.readTree(perform(post(url), ALICE, "{\"body\":\"Primero\"}")
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.isMine").value(true))
            .andExpect(jsonPath("$.isAuthor").value(false))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
        JsonNode a2 = json.readTree(perform(post(url), ALICE, "{\"body\":\"Segundo\"}")
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
        JsonNode op = json.readTree(perform(post(url), AUTHOR,
                "{\"body\":\"Gracias\",\"parentId\":\"" + a1.get("id").asText() + "\"}")
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.isAuthor").value(true))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));

        assertThat(a2.get("alias").asText()).isEqualTo(a1.get("alias").asText());
        assertThat(op.get("alias").asText()).isNotEqualTo(a1.get("alias").asText());

        // The author's comment alias is the proposal's authorAlias.
        perform(get("/v1/proposals/" + id), BOB, null)
            .andExpect(jsonPath("$.authorAlias").value(op.get("alias").asText()))
            .andExpect(jsonPath("$.commentCount").value(3));

        // Replying to a reply is refused.
        perform(post(url), BOB, "{\"body\":\"x\",\"parentId\":\"" + op.get("id").asText() + "\"}")
            .andExpect(status().isBadRequest());

        String asBob = perform(get(url), BOB, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta.total").value(2))
            .andExpect(jsonPath("$.data[0].body").value("Segundo"))
            .andExpect(jsonPath("$.data[0].isMine").value(false))
            .andExpect(jsonPath("$.data[1].body").value("Primero"))
            .andExpect(jsonPath("$.data[1].replies", hasSize(1)))
            .andExpect(jsonPath("$.data[1].replies[0].isAuthor").value(true))
            .andExpect(jsonPath("$.data[1].replies[0].alias").value(op.get("alias").asText()))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertAnonymous(asBob);
        perform(get(url), ALICE, null).andExpect(jsonPath("$.data[0].isMine").value(true));

        // Only the writer can delete; a deleted comment with replies stays as a tombstone.
        String first = a1.get("id").asText();
        perform(delete(url + "/" + first), BOB, null).andExpect(status().isNotFound());
        perform(delete(url + "/" + first), ALICE, null).andExpect(status().isNoContent());
        perform(delete(url + "/" + a2.get("id").asText()), ALICE, null).andExpect(status().isNoContent());

        perform(get(url), BOB, null)
            .andExpect(jsonPath("$.meta.total").value(1))
            .andExpect(jsonPath("$.data[0].id").value(first))
            .andExpect(jsonPath("$.data[0].deleted").value(true))
            .andExpect(jsonPath("$.data[0].body").doesNotExist())
            .andExpect(jsonPath("$.data[0].alias").doesNotExist())
            .andExpect(jsonPath("$.data[0].replies", hasSize(1)));
        perform(get("/v1/proposals/" + id), BOB, null).andExpect(jsonPath("$.commentCount").value(1));
    }

    @Test
    void accountDeletionUndoesVotesAndTombstonesComments() throws Exception {
        String id = createApproved("Sobreviviente", "OTROS");
        perform(put("/v1/proposals/" + id + "/vote"), ALICE, "{\"value\":\"UP\"}").andExpect(status().isOk());
        perform(put("/v1/proposals/" + id + "/vote"), BOB, "{\"value\":\"DOWN\"}").andExpect(status().isOk());
        perform(post("/v1/proposals/" + id + "/comments"), ALICE, "{\"body\":\"Chau\"}").andExpect(status().isCreated());
        String pending = create(ALICE, "Mía pendiente", "OTROS");

        perform(delete("/v1/me"), ALICE, null).andExpect(status().is2xxSuccessful());

        perform(get("/v1/proposals/" + id), BOB, null)
            .andExpect(jsonPath("$.upCount").value(0))
            .andExpect(jsonPath("$.downCount").value(1))
            .andExpect(jsonPath("$.commentCount").value(0));
        perform(get("/v1/proposals/" + id + "/comments"), BOB, null).andExpect(jsonPath("$.data", hasSize(0)));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.proposal WHERE id = ?::uuid",
            Integer.class, pending)).isZero();

        // The author deleting their account keeps the approved proposal, detached.
        perform(delete("/v1/me"), AUTHOR, null).andExpect(status().is2xxSuccessful());
        perform(get("/v1/proposals/" + id), BOB, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authorAlias").doesNotExist());
    }
}
