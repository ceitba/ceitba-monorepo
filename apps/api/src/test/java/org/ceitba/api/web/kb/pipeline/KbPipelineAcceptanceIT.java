package org.ceitba.api.web.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeLlmRequest;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
import org.ceitba.api.service.media.InMemoryObjectStorage;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Pipeline acceptance (docs/SUBJECT-WIKI-PIPELINE.md), run against both
// executors (BatchPipelineIT, SyncPipelineIT): the stored JSONL payloads are
// the same in both modes, so every assertion reads them.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(InMemoryObjectStorage.Config.class)
abstract class KbPipelineAcceptanceIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("auth.allowed-domains", () -> "itba.edu.ar");
        r.add("itba.api.use-fake", () -> "true");
    }

    static final String FIN = "61.12";
    static final String CONT = "81.07";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired KbRunEngine engine;
    @Autowired InMemoryObjectStorage storage;
    @Autowired LlmBatchClient batchClient;
    @Autowired SyncChatClient syncClient;

    UUID source;
    UUID f1;   // 61.12
    UUID f2;   // 61.12
    UUID f3;   // 81.07

    // "BATCH" or "SYNC": the mode every stage must run in.
    abstract String expectedMode();

    FakeLlmBatchClient fakeBatch() { return (FakeLlmBatchClient) batchClient; }
    FakeSyncChatClient fakeSync() { return (FakeSyncChatClient) syncClient; }

    void respond(Function<FakeLlmRequest, JsonNode> responder) {
        fakeBatch().respond(responder);
        fakeSync().respond(responder);
    }

    List<FakeLlmRequest> llmRequests() {
        var out = new ArrayList<FakeLlmRequest>(fakeBatch().submitted());
        out.addAll(fakeSync().received());
        return out;
    }

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, "
            + "wiki.kb_run CASCADE");
        jdbc.execute("TRUNCATE wiki.kb_file_digest, wiki.kb_subject_state, wiki.kb_llm_usage, "
            + "wiki.kb_pipeline_settings, wiki.kb_pipeline_settings_history CASCADE");
        jdbc.execute("TRUNCATE public.\"user\", public.plan_subject, public.subject, public.plan, public.careers CASCADE");
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES "
            + "('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())");
        var owner = UUID.randomUUID();
        jdbc.update("INSERT INTO public.\"user\" (id, email, name, created_at, updated_at) "
            + "VALUES (?, 'alumna@itba.edu.ar', 'Alumna', now(), now())", owner);
        source = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, "
            + "consented_at, approved_at) VALUES (?, ?, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())",
            source, owner);
        f1 = file("Guía VTD.pdf", FIN, text("alfa"));
        f2 = file("Resumen TIR.pdf", FIN, text("beta"));
        f3 = file("Balance.pdf", CONT, text("gamma"));
        storage.clear();
        fakeBatch().reset();
        fakeSync().reset();
        respond(KbFakeAnswers.responder(json, false));
    }

    // Unique words per file, so payloads can be searched for them.
    static String text(String tag) {
        return IntStream.range(0, 80).mapToObj(i -> tag + "palabra" + i).collect(Collectors.joining(" "));
    }

    UUID file(String name, String subject, String text) {
        var id = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, "
            + "subject_id, effective_subject_id, publication, text_content, content_fingerprint) "
            + "VALUES (?, ?, ?, ?, 'application/pdf', 'PDF', true, ?, ?, 'PUBLISHED', ?, ?)",
            id, source, "d-" + id, name, subject, subject, text, "fp-" + text.hashCode());
        return id;
    }

    void changeText(UUID id, String text) {
        jdbc.update("UPDATE wiki.drive_file SET text_content = ?, content_fingerprint = ? WHERE id = ?",
            text, "fp-" + text.hashCode(), id);
    }

    static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "staff@itba.edu.ar").claim("name", "Staff"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    JsonNode call(MockHttpServletRequestBuilder req, String body, int expected) throws Exception {
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
        var res = mvc.perform(req.with(staff())).andExpect(status().is(expected)).andReturn();
        var s = res.getResponse().getContentAsString(StandardCharsets.UTF_8);
        return s.isEmpty() ? null : json.readTree(s);
    }

    // Starts a manual run and advances it as far as it goes.
    JsonNode run() throws Exception {
        var started = call(post("/v1/staff/kb/pipeline/runs"), null, 202);
        engine.advanceActive();
        return call(get("/v1/staff/kb/pipeline/runs/" + started.path("id").asText()), null, 200);
    }

    // Every stored JSONL (payloads and outputs) of a run, concatenated.
    String stored(String runId) {
        var sb = new StringBuilder();
        for (var k : storage.keys()) {
            if (k.startsWith("kb/runs/" + runId + "/")) sb.append(new String(storage.get(k), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    List<String> payloadKeys(String runId) {
        return storage.keys().stream().filter(k -> k.startsWith("kb/runs/" + runId + "/")).toList();
    }

    List<String> modes(String runId) {
        return jdbc.queryForList("SELECT DISTINCT mode FROM wiki.kb_batch_job WHERE run_id = ?::uuid", String.class, runId);
    }

    List<String> publishedSlugs(String subject) {
        return jdbc.queryForList("SELECT slug FROM wiki.kb_page WHERE subject_id = ? AND status = 'PUBLISHED' ORDER BY slug",
            String.class, subject);
    }

    // ---- tests -----------------------------------------------------------------------

    @Test
    void noChangesMeansZeroRequests() throws Exception {
        assertThat(run().path("status").asText()).isEqualTo("SUCCEEDED");
        var base = call(post("/v1/staff/kb/pipeline/baseline"), null, 200);
        assertThat(base.path("subjects").toString()).contains(FIN, CONT);
        fakeBatch().reset();
        fakeSync().reset();
        long rows = jdbc.queryForObject("SELECT count(*) FROM wiki.kb_run_request", Long.class);
        long usage = jdbc.queryForObject("SELECT count(*) FROM wiki.kb_llm_usage", Long.class);
        var run = run();
        assertThat(run.path("status").asText()).isEqualTo("SUCCEEDED");
        assertThat(llmRequests()).isEmpty();
        assertThat(payloadKeys(run.path("id").asText())).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_run_request", Long.class)).isEqualTo(rows);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_llm_usage", Long.class)).isEqualTo(usage);
        assertThat(call(get("/v1/staff/kb/pipeline/preview"), null, 200).toString()).doesNotContain(FIN);
    }

    @Test
    void firstRunPublishesThenOnlyTheChangedFileIsSent() throws Exception {
        var first = run();
        assertThat(first.path("status").asText()).as(first.toString()).isEqualTo("SUCCEEDED");
        assertThat(modes(first.path("id").asText())).containsOnly(expectedMode());
        assertThat(publishedSlugs(FIN)).containsExactly("conceptos-centrales");
        assertThat(publishedSlugs(CONT)).containsExactly("conceptos-centrales");
        assertThat(first.path("costUsd").decimalValue()).isPositive();
        assertThat(first.path("simulated").asBoolean()).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_llm_usage WHERE simulated", Integer.class))
            .isPositive();

        // Nothing changed: zero requests.
        int before = llmRequests().size();
        var idle = run();
        assertThat(idle.path("status").asText()).isEqualTo("SUCCEEDED");
        assertThat(llmRequests()).hasSize(before);
        assertThat(payloadKeys(idle.path("id").asText())).isEmpty();

        // One file of 61.12 changes.
        changeText(f2, text("delta"));
        var second = run();
        var id = second.path("id").asText();
        assertThat(second.path("status").asText()).as(second.toString()).isEqualTo("SUCCEEDED");
        assertThat(modes(id)).containsOnly(expectedMode());
        var payloads = stored(id);
        assertThat(payloads).contains("deltapalabra1 ");
        // Raw text of unchanged files never appears in any stored payload.
        assertThat(payloads).doesNotContain("alfapalabra1 ", "gammapalabra1 ", "betapalabra1 ");
        var subjects = jdbc.queryForList("SELECT subject_id FROM wiki.kb_run_subject WHERE run_id = ?::uuid",
            String.class, id);
        assertThat(subjects).containsExactly(FIN);
        // Same page updated, not duplicated.
        assertThat(publishedSlugs(FIN)).containsExactly("conceptos-centrales");
    }

    @Test
    void digestsAreReusedByFingerprint() throws Exception {
        run();
        int digests = jdbc.queryForObject("SELECT count(*) FROM wiki.kb_file_digest", Integer.class);
        // A new file with the same content as f3 (another subject): no DIGEST request.
        file("Copia.pdf", FIN, text("gamma"));
        var again = run();
        var stages = jdbc.queryForList("SELECT DISTINCT stage FROM wiki.kb_run_request WHERE run_id = ?::uuid",
            String.class, again.path("id").asText());
        assertThat(stages).doesNotContain("DIGEST").contains("PLAN");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_file_digest", Integer.class)).isEqualTo(digests);
    }

    @Test
    void rejectedPagesGetOneRetry() throws Exception {
        respond(KbFakeAnswers.responder(json, true));
        var run = run();
        assertThat(run.path("status").asText()).as(run.toString()).isEqualTo("SUCCEEDED");
        var stages = jdbc.queryForList("SELECT DISTINCT stage FROM wiki.kb_run_request WHERE run_id = ?::uuid",
            String.class, run.path("id").asText());
        assertThat(stages).contains("WRITE", "RETRY");
        assertThat(publishedSlugs(FIN)).containsExactly("conceptos-centrales");
    }

    @Test
    void tokenBudgetDefersSubjectsWhichStayDirty() throws Exception {
        call(put("/v1/staff/kb/settings"), "{\"runTokenBudget\": 1}", 200);
        var run = run();
        assertThat(run.path("status").asText()).isEqualTo("SUCCEEDED");
        var statuses = jdbc.queryForList("SELECT status FROM wiki.kb_run_subject WHERE run_id = ?::uuid",
            String.class, run.path("id").asText());
        assertThat(statuses).containsOnly("DEFERRED");
        assertThat(llmRequests()).isEmpty();
        var preview = call(get("/v1/staff/kb/pipeline/preview"), null, 200);
        assertThat(preview.toString()).contains(FIN, CONT);
    }

    @Test
    void removedSoleSourceDeletesThePageWithoutRequests() throws Exception {
        run();
        int before = llmRequests().size();
        jdbc.update("UPDATE wiki.drive_file SET publication = 'REMOVED_BY_STAFF' WHERE id = ?", f3);
        var run = run();
        assertThat(run.path("status").asText()).as(run.toString()).isEqualTo("SUCCEEDED");
        assertThat(publishedSlugs(CONT)).isEmpty();
        assertThat(llmRequests()).hasSize(before);
    }

    @Test
    void costByStageAndUsageRows() throws Exception {
        var run = run();
        assertThat(run.path("costByStage").has("WRITE")).isTrue();
        var stages = jdbc.queryForList("SELECT DISTINCT stage FROM wiki.kb_llm_usage", String.class);
        assertThat(stages).contains("DIGEST", "PLAN", "WRITE");
        var summary = call(get("/v1/staff/kb/costs/summary"), null, 200);
        assertThat(summary.path("simulated").asBoolean()).isTrue();
        assertThat(summary.path("accuracy").path("lastRuns")).isNotEmpty();
    }
}
