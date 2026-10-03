package org.ceitba.api.web.sync;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Benefit;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.sync.ProposalFirestoreImporter;
import org.ceitba.api.web.auth.ApiKeyFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/sync/import/firestore end to end against Postgres, with the
// PII-free fixture in src/test/resources/fixtures/firestore-export.json.
@SpringBootTest(properties = {
    "auth.sync-api-key=test-sync-key",
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true"
})
@AutoConfigureMockMvc
class FirestoreImportIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired UserFollowRepository follows;
    @Autowired CeitbaModeratorRepository moderators;
    @Autowired CareerRepository careers;
    @Autowired PlanRepository plans;
    @Autowired BenefitRepository categories;
    @Autowired BenefitCardRepository cards;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    private String fixture;

    @BeforeEach
    void seed() throws Exception {
        jdbc.execute("DELETE FROM public.proposal");
        moderators.deleteAll();
        follows.deleteAll();
        users.deleteAll();
        cards.deleteAll();
        categories.deleteAll();
        plans.deleteAll();
        careers.deleteAll();

        var s = careers.save(new Career("S", "Ingeniería en Informática"));
        var entrance = careers.save(new Career("PAI", "Proceso de Admisión"));
        plans.save(new Plan("S10-Rev23", s, "S10-Rev23"));
        plans.save(new Plan("PX-Current", entrance, "PX-Current"));
        categories.save(new Benefit("convenios", "--dept-color-media", 1));
        categories.save(new Benefit("deportes", "--dept-color-infra", 2));

        fixture = new ClassPathResource("fixtures/firestore-export.json")
            .getContentAsString(StandardCharsets.UTF_8);
    }

    private ResultActions runImport(boolean dryRun) throws Exception {
        return mvc.perform(post("/v1/sync/import/firestore")
            .param("dryRun", Boolean.toString(dryRun))
            .header(ApiKeyFilter.HEADER, "test-sync-key")
            .contentType(MediaType.APPLICATION_JSON)
            .content(fixture));
    }

    private User user(String uid) {
        return tx.execute(st -> {
            var u = users.findByFirebaseUid(uid).orElseThrow();
            if (u.getCareer() != null) u.getCareer().getId();
            return u;
        });
    }

    @Test
    void requiresSyncApiKey() throws Exception {
        mvc.perform(post("/v1/sync/import/firestore")
                .contentType(MediaType.APPLICATION_JSON)
                .content(fixture))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void dryRunReportsWithoutWriting() throws Exception {
        runImport(true)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dryRun").value(true))
            .andExpect(jsonPath("$.created").value(9))
            .andExpect(jsonPath("$.updated").value(0))
            .andExpect(jsonPath("$.skipped").value(0))
            .andExpect(jsonPath("$.errors.length()").value(2))
            .andExpect(jsonPath("$.errors[0].id").value("uid-sin-email"))
            .andExpect(jsonPath("$.errors[1].id").value("prop-invalida"));

        assertThat(users.count()).isZero();
        assertThat(cards.count()).isZero();
        assertThat(moderators.count()).isZero();
        assertThat(proposalCount()).isZero();
    }

    @Test
    void importsFixtureAndRerunIsIdempotent() throws Exception {
        runImport(false)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dryRun").value(false))
            .andExpect(jsonPath("$.usuarios.created").value(4))
            .andExpect(jsonPath("$.usuarios.errors").value(1))
            .andExpect(jsonPath("$.benefits.created").value(2))
            .andExpect(jsonPath("$.propuestas.created").value(3))
            .andExpect(jsonPath("$.propuestas.errors").value(1))
            .andExpect(jsonPath("$.errors[0].collection").value("usuarios"))
            .andExpect(jsonPath("$.errors[0].message").value("missing or invalid email"))
            // Reports never echo emails.
            .andExpect(content().string(not(containsString("example.test\""))));

        assertThat(users.count()).isEqualTo(4);
        assertThat(cards.count()).isEqualTo(2);

        var alumno = user("uid-alumno-1");
        assertThat(alumno.getEmail()).isEqualTo("alumno.uno@example.test");
        assertThat(alumno.getCareer().getId()).isEqualTo("S");
        assertThat(alumno.getPlan()).isEqualTo("S10-Rev23");
        assertThat(alumno.getLinkedin()).isEqualTo("alumno-uno");
        assertThat(alumno.getInstagram()).isEqualTo("alumno.uno");
        assertThat(alumno.getDiscord()).isNull();
        assertThat(alumno.getFileNumber()).isNull();

        // Legacy entrance-program values: left for the user to pick.
        for (var uid : new String[] {"uid-ingreso-1", "uid-ingreso-2"}) {
            var u = user(uid);
            assertThat(u.getCareer()).isNull();
            assertThat(u.getPlan()).isNull();
        }

        var mod = user("uid-mod-1");
        assertThat(mod.getCareer().getId()).isEqualTo("S");
        assertThat(mod.getPlan()).isNull();
        assertThat(mod.getLinkedin()).isNull();
        assertThat(mod.getDiscord()).isEqualTo("mod_1");
        assertThat(moderators.isActiveModerator(mod.getId())).isTrue();
        assertThat(moderators.isActiveModerator(alumno.getId())).isFalse();

        var pizza = cards.findByTitleEsIgnoreCase("Pizzería");
        assertThat(pizza).singleElement().satisfies(c -> {
            assertThat(c.getCategorySlug()).isEqualTo("convenios");
            assertThat(c.getBulletsEs()).containsExactly("2x1 los martes");
        });
        assertThat(cards.findByTitleEsIgnoreCase("Gimnasio")).singleElement()
            .satisfies(c -> assertThat(c.getCtaUrl()).isEqualTo("https://forms.example.test/gym"));

        runImport(false)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.created").value(0))
            .andExpect(jsonPath("$.updated").value(0))
            .andExpect(jsonPath("$.skipped").value(9));

        assertThat(users.count()).isEqualTo(4);
        assertThat(cards.count()).isEqualTo(2);
        assertThat(moderators.count()).isEqualTo(1);
        assertThat(proposalCount()).isEqualTo(3);
    }

    @Test
    void importKeepsValuesAlreadySetInTheNewSystem() throws Exception {
        var existing = new User(UUID.randomUUID(), "alumno.uno@example.test", "Nombre Google");
        existing.setInstagram("elegido.en.la.app");
        users.save(existing);

        runImport(false).andExpect(status().isOk())
            .andExpect(jsonPath("$.usuarios.created").value(3))
            .andExpect(jsonPath("$.usuarios.updated").value(1));

        var u = user("uid-alumno-1");
        assertThat(u.getId()).isEqualTo(existing.getId());
        assertThat(u.getName()).isEqualTo("Nombre Google");
        assertThat(u.getInstagram()).isEqualTo("elegido.en.la.app");
        assertThat(u.getCareer().getId()).isEqualTo("S");
    }

    private int proposalCount() {
        return jdbc.queryForObject("SELECT count(*) FROM public.proposal", Integer.class);
    }

    private static UUID proposal(String documentId) {
        return ProposalFirestoreImporter.proposalId(documentId);
    }

    private static RequestPostProcessor viewer() {
        return jwt().jwt(t -> t.claim("email", "lector@itba.edu.ar").claim("name", "Lector"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void importsLegacyProposalsIntoTheBoard() throws Exception {
        runImport(false)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.errors[1].collection").value("propuestas"))
            .andExpect(jsonPath("$.errors[1].message").value("authorized must be 0, 1 or 2"))
            .andExpect(jsonPath("$.warnings[?(@.id == 'prop-1')].message",
                hasItem("1 votes by users not imported dropped")))
            // A raw Firebase download URL is never stored: only keys the
            // export's --copy-attachments step put in the bucket.
            .andExpect(jsonPath("$.warnings[?(@.id == 'prop-1')].message",
                hasItem("1 filesURL entries not copied to object storage dropped (re-export with --copy-attachments)")))
            .andExpect(jsonPath("$.warnings[?(@.id == 'prop-1')].message",
                hasItem("1 malformed filesURL entries dropped")))
            .andExpect(jsonPath("$.warnings[?(@.id == 'prop-3')].message",
                hasItem("author not imported; proposal kept without author")))
            // Warnings name counts, never Firebase uids of other users.
            .andExpect(content().string(not(containsString("uid-no-importado"))));

        var alumno = user("uid-alumno-1");
        var mod = user("uid-mod-1");
        UUID p1 = proposal("prop-1");
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM public.proposal WHERE id = ?", p1);
        assertThat(row).containsEntry("author_id", alumno.getId())
            .containsEntry("status", "APPROVED")
            .containsEntry("lifecycle", "ACEPTADO")
            .containsEntry("topic", "VIDA_UNIVERSITARIA")
            .containsEntry("rejection_reason", null)
            .containsEntry("moderated_by", mod.getId())
            .containsEntry("up_count", 1)
            .containsEntry("down_count", 1)
            .containsEntry("comment_count", 3);
        assertThat(((java.sql.Timestamp) row.get("created_at")).toInstant())
            .isEqualTo(OffsetDateTime.of(2024, 5, 1, 12, 0, 0, 0, ZoneOffset.UTC).toInstant());

        mvc.perform(get("/v1/proposals/" + p1).with(viewer()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Más microondas"))
            .andExpect(jsonPath("$.authorAlias").value("AlfaRojo"))
            .andExpect(jsonPath("$.upCount").value(1))
            .andExpect(jsonPath("$.downCount").value(1))
            .andExpect(jsonPath("$.commentCount").value(3))
            .andExpect(jsonPath("$.attachments.length()").value(1))
            .andExpect(jsonPath("$.attachments[0].position").value(0))
            .andExpect(jsonPath("$.attachments[0].contentType").value("image/jpeg"));
        assertThat(jdbc.queryForList("SELECT object_key FROM public.proposal_attachment WHERE proposal_id = ?",
            String.class, p1)).containsExactly("proposals/legacy/5d41402a-bc4b-4a76-b971-9d911017c592.jpg");

        // Newest top-level first; the reply hangs from its comment; the
        // commenter who was never imported keeps the text but no alias.
        mvc.perform(get("/v1/proposals/" + p1 + "/comments").with(viewer()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.data[0].body").value("Comentario sin usuario"))
            .andExpect(jsonPath("$.data[0].alias").value(nullValue()))
            .andExpect(jsonPath("$.data[1].body").value("Buena idea"))
            .andExpect(jsonPath("$.data[1].alias").value("BetaAzul"))
            .andExpect(jsonPath("$.data[1].replies[0].body").value("Gracias"))
            .andExpect(jsonPath("$.data[1].replies[0].alias").value("AlfaRojo"))
            .andExpect(jsonPath("$.data[1].replies[0].isAuthor").value(true));

        // Only resolvable users get aliases; the author of a proposal without
        // userNames gets a generated one.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.proposal_alias WHERE proposal_id = ?",
            Integer.class, p1)).isEqualTo(2);
        UUID p2 = proposal("prop-2");
        assertThat(jdbc.queryForMap("SELECT status, lifecycle, topic, author_id, moderated_by FROM public.proposal WHERE id = ?", p2))
            .containsEntry("status", "PENDING").containsEntry("lifecycle", "ABIERTO").containsEntry("topic", "CEITBA")
            .containsEntry("author_id", user("uid-ingreso-1").getId()).containsEntry("moderated_by", null);
        assertThat(jdbc.queryForObject("SELECT alias FROM public.proposal_alias WHERE proposal_id = ?", String.class, p2))
            .isNotBlank();

        UUID p3 = proposal("prop-3");
        assertThat(jdbc.queryForMap("SELECT status, topic, author_id, rejection_reason FROM public.proposal WHERE id = ?", p3))
            .containsEntry("status", "REJECTED").containsEntry("topic", "OTROS")
            .containsEntry("author_id", null).containsEntry("rejection_reason", "Duplicada");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.proposal WHERE id = ?", Integer.class,
            proposal("prop-invalida"))).isZero();
    }

    @Test
    void proposalRerunAddsOnlyWhatIsMissingAndKeepsNewActivity() throws Exception {
        runImport(false).andExpect(status().isOk());
        UUID p1 = proposal("prop-1");

        // Activity in the new system after the import.
        mvc.perform(put("/v1/proposals/" + p1 + "/vote").with(viewer())
                .contentType(MediaType.APPLICATION_JSON).content("{\"value\":\"UP\"}"))
            .andExpect(status().isOk());
        mvc.perform(post("/v1/proposals/" + p1 + "/comments").with(viewer())
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Nuevo comentario\"}"))
            .andExpect(status().isCreated());

        // A later export has one more legacy comment on prop-1.
        var export = (ObjectNode) json.readTree(fixture);
        for (var doc : (ArrayNode) export.get("propuestas")) {
            if (doc.get("id").asText().equals("prop-1")) {
                ((ArrayNode) doc.get("comments")).addObject()
                    .put("author", "uid-mod-1").put("comment", "Otro más").put("dateTime", "2024-05-05T10:00:00.000Z");
            }
        }
        fixture = json.writeValueAsString(export);

        runImport(false)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.propuestas.created").value(0))
            .andExpect(jsonPath("$.propuestas.updated").value(1))
            .andExpect(jsonPath("$.propuestas.skipped").value(2));

        assertThat(jdbc.queryForMap("SELECT up_count, down_count, comment_count FROM public.proposal WHERE id = ?", p1))
            .containsEntry("up_count", 2).containsEntry("down_count", 1).containsEntry("comment_count", 5);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public.proposal_comment WHERE proposal_id = ? AND body = 'Otro más'",
            Integer.class, p1)).isEqualTo(1);

        runImport(false).andExpect(jsonPath("$.propuestas.skipped").value(3));
    }

    @Test
    void firebaseUidIsUnique() {
        var a = new User(UUID.randomUUID(), "a@example.test", "A");
        a.setFirebaseUid("uid-dup");
        users.saveAndFlush(a);
        var b = new User(UUID.randomUUID(), "b@example.test", "B");
        b.setFirebaseUid("uid-dup");

        assertThatThrownBy(() -> users.saveAndFlush(b)).isInstanceOf(DataIntegrityViolationException.class);
    }
}
