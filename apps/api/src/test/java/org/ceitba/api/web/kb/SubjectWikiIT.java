package org.ceitba.api.web.kb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.service.kb.KbRelationService;
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

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Subject wikis end to end: import with validation, revisions and replace;
// reader endpoints; a cross-subject link that resolves once the target
// subject is imported; related subjects from plan prerequisites; takedown
// of a cited Drive file hides the page; 3 reports hide a page.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = {"auth.allowed-domains=itba.edu.ar", "itba.api.use-fake=true"})
class SubjectWikiIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    static final String FIN = "61.12";
    static final String CONT = "81.07";
    static final String STAFF = "staff@itba.edu.ar";
    static final String SOURCE_TEXT = IntStream.range(0, 120).mapToObj(i -> "palabra" + i)
        .collect(Collectors.joining(" "));

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired KbRelationService relations;
    @Autowired org.ceitba.api.service.kb.KbGraphService graphService;

    UUID f1;       // published file of 61.12
    UUID f2;       // published file of 61.12
    UUID fCont;    // published file of 81.07
    UUID fOther;   // published file of 81.07, cited from 61.12 (invalid)

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, "
            + "public.\"user\", public.plan_subject, public.subject, public.plan, public.careers CASCADE");
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES "
            + "('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now()), "
            + "('93.26', 'Análisis Matemático I', 6, now())");
        jdbc.update("INSERT INTO public.careers (id, name, updated_at) VALUES ('X', 'Carrera', now())");
        jdbc.update("INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('P1', 'X', 'Plan', now())");
        // 61.12 requires 81.07.
        jdbc.update("INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, "
            + "dependencies) VALUES ('61.12', 'P1', 'Ciclo', 2, 1, 0, ARRAY['81.07']), "
            + "('81.07', 'P1', 'Ciclo', 1, 2, 0, ARRAY[]::varchar[])");
        relations.refresh();
        graphService.invalidate();   // the tables were truncated behind its back

        var owner = UUID.randomUUID();
        jdbc.update("INSERT INTO public.\"user\" (id, email, name, created_at, updated_at) "
            + "VALUES (?, 'alumna@itba.edu.ar', 'Alumna', now(), now())", owner);
        var staff = UUID.randomUUID();
        jdbc.update("INSERT INTO public.\"user\" (id, email, name, created_at, updated_at) "
            + "VALUES (?, ?, 'Staff', now(), now())", staff, STAFF);
        jdbc.update("INSERT INTO public.ceitba_staff (user_id, branch, role, start, \"end\") "
            + "VALUES (?, 'IT', 'MEMBER', now() - interval '1 day', '9999-12-31')", staff);
        var source = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, "
            + "consented_at, approved_at) VALUES (?, ?, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())",
            source, owner);
        f1 = file(source, "Guía VTD.pdf", FIN);
        f2 = file(source, "Resumen TIR.pdf", FIN);
        fCont = file(source, "Balance.pdf", CONT);
        fOther = file(source, "Otro.pdf", CONT);
    }

    UUID file(UUID source, String name, String subject) {
        var id = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, "
            + "subject_id, effective_subject_id, publication, text_content, content_fingerprint) "
            + "VALUES (?, ?, ?, ?, 'application/pdf', 'PDF', true, ?, ?, 'PUBLISHED', ?, 'x')",
            id, source, "d-" + id, name, subject, subject, SOURCE_TEXT);
        return id;
    }

    // ---- helpers ---------------------------------------------------------

    static RequestPostProcessor as(String email, String... roles) {
        var authorities = new ArrayList<GrantedAuthority>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
        for (var r : roles) authorities.add(new SimpleGrantedAuthority("ROLE_" + r));
        return jwt().jwt(t -> t.claim("email", email).claim("name", email)).authorities(authorities);
    }

    static RequestPostProcessor staff() { return as(STAFF, "STAFF"); }
    static RequestPostProcessor reader(int n) { return as("lector" + n + "@itba.edu.ar"); }

    ResultActions call(MockHttpServletRequestBuilder req, RequestPostProcessor who, String body) throws Exception {
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
        return mvc.perform(who == null ? req : req.with(who));
    }

    JsonNode read(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    static String md(String subject, String type, String title, List<UUID> sources, String body) {
        return "---\ntitle: " + title + "\nsubject: \"" + subject + "\"\ntype: " + type + "\nsummary: Sobre " + title
            + ".\naliases: []\nsources: [" + sources.stream().map(UUID::toString).collect(Collectors.joining(", "))
            + "]\ngenerator: claude-opus-5.5/manual\ngenerated_at: 2026-10-02\n---\n" + body;
    }

    JsonNode importPages(String subject, boolean replace, Map<String, String> pages) throws Exception {
        var payload = Map.of("replace", replace, "pages",
            pages.entrySet().stream().map(e -> Map.of("path", e.getKey(), "content", e.getValue())).toList());
        return read(call(post("/v1/staff/kb/subjects/" + subject + "/import"), staff(),
            json.writeValueAsString(payload)).andExpect(status().isOk()));
    }

    String finIndex() {
        return md(FIN, "index", "Matemática Financiera", List.of(f1),
            "Bienvenida. Ver [[vtd]], [[81.07/balance|el balance]] y [[81.07]].\n\n## Temas\n"
                + "Interés compuesto [[file:" + f1 + "]].\n");
    }

    String vtd(String extra) {
        return md(FIN, "concept", "Valor tiempo del dinero", List.of(f1, f2),
            "## Idea\nUn peso hoy vale más que mañana [[file:" + f1 + "]]." + extra
                + "\n\n## Tasa\nVer [[index]] y [[file:" + f2 + "|resumen]].\n");
    }

    // ---- the flow --------------------------------------------------------

    @Test
    void importReadLinkTakedownAndReport() throws Exception {
        var copied = IntStream.range(3, 50).mapToObj(i -> "palabra" + i).collect(Collectors.joining(" "));
        var res = importPages(FIN, true, Map.of(
            "index.md", finIndex(),
            "vtd.md", vtd(""),
            "ajeno.md", md(FIN, "concept", "Ajeno", List.of(fOther), "## A\n[[file:" + fOther + "]]\n"),
            "copia.md", md(FIN, "concept", "Copia", List.of(f1), "## A\n" + copied + " [[file:" + f1 + "]]\n"),
            "sin-cita.md", md(FIN, "topic", "Sin cita", List.of(), "## A\nnada\n")));
        assertThat(json.convertValue(res.get("accepted"), List.class)).containsExactlyInAnyOrder("index", "vtd");
        var rejected = res.get("rejected");
        assertThat(rejected).hasSize(3);
        for (var r : rejected) {
            var errors = r.get("errors").toString();
            switch (r.get("slug").asText()) {
                case "ajeno" -> assertThat(errors).contains("is not a file of subject 61.12");
                case "copia" -> assertThat(errors).contains("copies 40+ consecutive words");
                case "sin-cita" -> assertThat(errors).contains("has no [[file:");
                default -> throw new AssertionError(r);
            }
        }
        // Unknown subject.
        call(post("/v1/staff/kb/subjects/99.99/import"), staff(), "{\"pages\":[],\"replace\":false}")
            .andExpect(status().isNotFound());
        call(post("/v1/staff/kb/subjects/" + FIN + "/import"), reader(1), "{\"pages\":[],\"replace\":false}")
            .andExpect(status().isForbidden());

        // Read: index + pages + related (prerequisite from the plan).
        var kb = read(call(get("/v1/wiki/subjects/" + FIN + "/kb"), reader(1), null).andExpect(status().isOk()));
        assertThat(kb.get("subjectName").asText()).isEqualTo("Matemática Financiera");
        assertThat(kb.get("index").get("slug").asText()).isEqualTo("index");
        assertThat(kb.get("pages").findValuesAsText("slug")).containsExactly("index", "vtd");
        assertThat(kb.get("pages").get(1).get("type").asText()).isEqualTo("concept");
        assertThat(kb.get("related")).hasSize(1);
        assertThat(kb.get("related").get(0).get("subjectId").asText()).isEqualTo(CONT);
        assertThat(kb.get("related").get(0).get("reason").asText()).isEqualTo("PREREQUISITE");
        assertThat(kb.get("related").get(0).get("hasWiki").asBoolean()).isFalse();

        var index = kb.get("index");
        assertThat(index.get("markdown").asText()).startsWith("Bienvenida").doesNotContain("generator:");
        assertThat(index.get("links")).hasSize(3);
        assertThat(link(index, "vtd").get("resolved").asBoolean()).isTrue();
        assertThat(link(index, "vtd").get("title").asText()).isEqualTo("Valor tiempo del dinero");
        assertThat(link(index, "81.07/balance").get("resolved").asBoolean()).isFalse();
        assertThat(link(index, "81.07").get("slug").asText()).isEqualTo("index");

        var page = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null).andExpect(status().isOk()));
        assertThat(page.get("revision").asInt()).isEqualTo(1);
        assertThat(page.get("sources")).hasSize(2);
        assertThat(page.get("sources").get(0).get("name").asText()).isEqualTo("Guía VTD.pdf");
        assertThat(page.get("sources").get(1).get("name").asText()).isEqualTo("Resumen TIR.pdf");
        assertThat(page.get("sources").get(0).get("author").get("name").asText()).isEqualTo("Alumna");
        assertThat(page.get("backlinks")).hasSize(1);
        assertThat(page.get("backlinks").get(0).get("slug").asText()).isEqualTo("index");
        call(get("/v1/wiki/subjects/" + FIN + "/kb/ajeno"), reader(1), null).andExpect(status().isNotFound());

        // The second subject arrives: the cross-subject links resolve.
        importPages(CONT, false, Map.of(
            "index.md", md(CONT, "index", "Contabilidad", List.of(fCont), "## Temas\n[[balance]] [[file:" + fCont + "]]\n"),
            "balance.md", md(CONT, "concept", "Balance", List.of(fCont),
                "## Qué es\nVuelve a [[61.12/vtd]] [[file:" + fCont + "]]\n")));
        index = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(1), null));
        assertThat(link(index, "81.07/balance").get("resolved").asBoolean()).isTrue();
        assertThat(link(index, "81.07/balance").get("title").asText()).isEqualTo("Balance");
        assertThat(link(index, "81.07").get("resolved").asBoolean()).isTrue();
        page = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null));
        assertThat(page.get("backlinks").findValuesAsText("subjectId")).contains(CONT);
        kb = read(call(get("/v1/wiki/subjects/" + FIN + "/kb"), reader(1), null));
        assertThat(kb.get("related").get(0).get("hasWiki").asBoolean()).isTrue();
        // 81.07 sees 61.12 as a dependent.
        var cont = read(call(get("/v1/wiki/subjects/" + CONT + "/kb"), reader(1), null));
        assertThat(cont.get("related").get(0).get("reason").asText()).isEqualTo("DEPENDENT");

        var graph = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/graph"), reader(1), null).andExpect(status().isOk()));
        assertThat(graph.get("nodes")).hasSize(4);
        assertThat(graph.get("nodes").findValuesAsText("external")).containsExactly("false", "false", "true", "true");
        assertThat(graph.get("edges").size()).isGreaterThanOrEqualTo(4);

        // Re-import: changed page gets a new revision; unchanged keeps it;
        // replace drops pages missing from the payload.
        res = importPages(FIN, true, Map.of("vtd.md", vtd(" Nuevo párrafo.")));
        assertThat(json.convertValue(res.get("removed"), List.class)).containsExactly("index");
        page = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null));
        assertThat(page.get("revision").asInt()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_page_revision", Integer.class)).isEqualTo(1);
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(1), null).andExpect(status().isNotFound());
        importPages(FIN, false, Map.of("index.md", finIndex(), "vtd.md", vtd(" Nuevo párrafo.")));
        page = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null));
        assertThat(page.get("revision").asInt()).isEqualTo(2);
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(1), null).andExpect(status().isOk());

        // Takedown: staff remove a cited file -> pages citing it are hidden.
        call(post("/v1/staff/drive/files/" + f2 + "/remove"), staff(), null).andExpect(status().isOk());
        call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null).andExpect(status().isNotFound());
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(1), null).andExpect(status().isOk());
        call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), staff(), null)
            .andExpect(jsonPath("$.status").value("HIDDEN"));
        var hidden = read(call(get("/v1/staff/kb/pages?status=HIDDEN"), staff(), null).andExpect(status().isOk()));
        assertThat(hidden.get("total").asInt()).isEqualTo(1);
        var vtdId = hidden.get("items").get(0).get("id").asText();
        assertThat(hidden.get("items").get(0).get("subjectId").asText()).isEqualTo(FIN);
        // A re-import (now without the removed file) keeps it hidden until
        // staff restore it.
        var reimport = importPages(FIN, false, Map.of("vtd.md", md(FIN, "concept", "Valor tiempo del dinero",
            List.of(f1), "## Idea\nUn peso hoy [[file:" + f1 + "]].\n")));
        assertThat(json.convertValue(reimport.get("accepted"), List.class)).containsExactly("vtd");
        call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null).andExpect(status().isNotFound());
        call(post("/v1/staff/kb/pages/" + vtdId + "/restore"), staff(), null)
            .andExpect(jsonPath("$.status").value("PUBLISHED"));
        call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null).andExpect(status().isOk());

        // Blocking the source hides every page citing its files.
        var sourceId = jdbc.queryForObject("SELECT source_id FROM wiki.drive_file WHERE id = ?", UUID.class, fCont);
        call(post("/v1/staff/drive/sources/" + sourceId + "/block"), staff(), null).andExpect(status().isOk());
        call(get("/v1/wiki/subjects/" + CONT + "/kb/balance"), reader(1), null).andExpect(status().isNotFound());
    }

    @Test
    void threeReportsHideAPage() throws Exception {
        importPages(FIN, false, Map.of("index.md", finIndex()));
        var id = read(call(get("/v1/wiki/subjects/" + FIN + "/kb"), reader(1), null)).get("index").get("id").asText();
        String body = "{\"reason\":\"CONTENT_ERROR\",\"comment\":\"la fórmula está mal\"}";
        call(put("/v1/wiki/kb/pages/" + id + "/report"), reader(1), body).andExpect(status().isNoContent());
        call(put("/v1/wiki/kb/pages/" + id + "/report"), reader(1), body).andExpect(status().isNoContent());
        call(put("/v1/wiki/kb/pages/" + id + "/report"), reader(2), "{\"reason\":\"SPAM\"}").andExpect(status().isNoContent());
        call(put("/v1/wiki/kb/pages/" + id + "/report"), reader(3), "{\"reason\":\"NOPE\"}").andExpect(status().isBadRequest());
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(1), null)
            .andExpect(jsonPath("$.reportedByMe").value(true));
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(3), null)
            .andExpect(jsonPath("$.reportedByMe").value(false));

        call(put("/v1/wiki/kb/pages/" + id + "/report"), reader(3), "{\"reason\":\"OTHER\"}").andExpect(status().isNoContent());
        call(get("/v1/wiki/subjects/" + FIN + "/kb/index"), reader(4), null).andExpect(status().isNotFound());
        call(get("/v1/wiki/subjects/" + FIN + "/kb"), reader(4), null)
            .andExpect(jsonPath("$.index").doesNotExist())
            .andExpect(jsonPath("$.pages").isEmpty());
        call(get("/v1/staff/kb/pages"), staff(), null)
            .andExpect(jsonPath("$.items[0].reportCount").value(3));
        call(post("/v1/staff/kb/pages/" + id + "/restore"), staff(), null)
            .andExpect(jsonPath("$.status").value("PUBLISHED"));
        call(post("/v1/staff/kb/pages/" + id + "/hide"), staff(), null)
            .andExpect(jsonPath("$.status").value("HIDDEN"));
    }

    @Test
    void sectionAnchorsAreValidatedAgainstExistingTargets() throws Exception {
        importPages(FIN, false, Map.of("index.md", finIndex(), "vtd.md", vtd("")));
        var res = importPages(FIN, false, Map.of(
            "ok.md", md(FIN, "concept", "Ok", List.of(f1), "## Uno\nVer [[vtd#Idea]], [[#Uno|acá]] y "
                + "[[81.07/balance#cualquiera]] [[file:" + f1 + "]]\n"),
            "mal.md", md(FIN, "concept", "Mal", List.of(f1), "## Uno\nVer [[vtd#no-existe]] [[file:" + f1 + "]]\n")));
        assertThat(json.convertValue(res.get("accepted"), List.class)).containsExactly("ok");
        assertThat(res.get("rejected").get(0).get("errors").get(0).asText())
            .isEqualTo("link [[vtd#no-existe]]: no heading '#no-existe' in 61.12/vtd");
        var ok = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/ok"), reader(1), null).andExpect(status().isOk()));
        assertThat(link(ok, "vtd#Idea").get("anchor").asText()).isEqualTo("idea");
        assertThat(link(ok, "vtd#Idea").get("slug").asText()).isEqualTo("vtd");
        assertThat(link(ok, "vtd#Idea").get("resolved").asBoolean()).isTrue();
        assertThat(link(ok, "#Uno").get("slug").asText()).isEqualTo("ok");
        // The target subject has no pages yet: unresolved, not rejected.
        assertThat(link(ok, "81.07/balance#cualquiera").get("resolved").asBoolean()).isFalse();
        assertThat(link(ok, "81.07/balance#cualquiera").get("anchor").asText()).isEqualTo("cualquiera");
        // A same-page anchor is not a backlink or a graph self-loop.
        assertThat(ok.get("backlinks")).isEmpty();
    }

    @Test
    void globalGraphIsCachedAndInvalidated() throws Exception {
        importPages(FIN, false, Map.of("index.md", finIndex(), "vtd.md", vtd("")));
        importPages(CONT, false, Map.of(
            "index.md", md(CONT, "index", "Contabilidad", List.of(fCont), "## Temas\n[[balance]] [[file:" + fCont + "]]\n"),
            "balance.md", md(CONT, "concept", "Balance", List.of(fCont),
                "## Qué es\nVuelve a [[61.12/vtd]] y [[#Qué es]] [[file:" + fCont + "]]\n")));

        call(get("/v1/wiki/kb/graph"), null, null).andExpect(status().isUnauthorized());
        var g = read(call(get("/v1/wiki/kb/graph"), reader(1), null).andExpect(status().isOk()));
        assertThat(g.get("subjects")).hasSize(2);
        assertThat(g.get("subjects").get(0).get("subjectId").asText()).isEqualTo(FIN);
        assertThat(g.get("subjects").get(0).get("pageCount").asLong()).isEqualTo(2);
        assertThat(g.get("nodes")).hasSize(4);
        // FIN index->vtd, index->balance, index->CONT index, vtd->index,
        // CONT index->balance, balance->vtd; no self-loop for [[#Qué es]].
        assertThat(g.get("edges")).hasSize(6);
        long cross = 0;
        for (var e : g.get("edges")) {
            assertThat(e.get("from").asText()).isNotEqualTo(e.get("to").asText());
            if (e.get("crossSubject").asBoolean()) cross++;
        }
        assertThat(cross).isEqualTo(3);

        // Restricted to 81.07: its pages plus the 61.12 pages linked from/to them.
        var only = read(call(get("/v1/wiki/kb/graph?subjects=81.07"), reader(1), null).andExpect(status().isOk()));
        assertThat(only.get("nodes")).hasSize(4);
        assertThat(only.get("edges")).hasSize(4);

        // Hiding a page invalidates the cache.
        var vtdId = read(call(get("/v1/wiki/subjects/" + FIN + "/kb/vtd"), reader(1), null)).get("id").asText();
        call(post("/v1/staff/kb/pages/" + vtdId + "/hide"), staff(), null).andExpect(status().isOk());
        g = read(call(get("/v1/wiki/kb/graph"), staff(), null));
        assertThat(g.get("nodes")).hasSize(3);
        assertThat(g.get("subjects").get(0).get("pageCount").asLong()).isEqualTo(1);
        call(post("/v1/staff/kb/pages/" + vtdId + "/restore"), staff(), null).andExpect(status().isOk());
        assertThat(read(call(get("/v1/wiki/kb/graph"), reader(1), null)).get("nodes")).hasSize(4);
    }

    static JsonNode link(JsonNode page, String raw) {
        for (var l : page.get("links")) if (l.get("raw").asText().equals(raw)) return l;
        throw new AssertionError("no link " + raw + " in " + page.get("links"));
    }
}
