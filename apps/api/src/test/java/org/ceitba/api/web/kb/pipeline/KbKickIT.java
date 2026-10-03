package org.ceitba.api.web.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.service.media.InMemoryObjectStorage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// With the background job on but every poller an hour away, a new eval and a
// dry run advance right away (kick on the task executor), without any tick.
@SpringBootTest(properties = {
    "kb.pipeline.background=true",
    "kb.pipeline.poll-interval=PT1H",
    "kb.pipeline.batch-poll-interval=PT1H",
    "kb.llm.execution-mode=sync"
})
@AutoConfigureMockMvc
@Testcontainers
@Import(InMemoryObjectStorage.Config.class)
class KbKickIT {

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

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired SyncChatClient syncClient;

    JsonNode call(MockHttpServletRequestBuilder req, String body, int expected) throws Exception {
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
        var res = mvc.perform(req.with(KbPipelineAcceptanceIT.staff())).andExpect(status().is(expected)).andReturn();
        return json.readTree(res.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    JsonNode await(String path) throws Exception {
        JsonNode last = null;
        for (int i = 0; i < 150; i++) {
            last = call(get(path), null, 200);
            var s = last.path("status").asText();
            if (s.equals("SUCCEEDED") || s.equals("FAILED")) return last;
            Thread.sleep(100);
        }
        return last;
    }

    @Test
    void evalAndDryRunAdvanceWithoutAPollerTick() throws Exception {
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now())");
        var owner = UUID.randomUUID();
        jdbc.update("INSERT INTO public.\"user\" (id, email, name, created_at, updated_at) "
            + "VALUES (?, 'alumna@itba.edu.ar', 'Alumna', now(), now())", owner);
        var source = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, "
            + "consented_at, approved_at) VALUES (?, ?, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())", source, owner);
        var text = KbPipelineAcceptanceIT.text("alfa");
        jdbc.update("INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, "
            + "subject_id, effective_subject_id, publication, text_content, content_fingerprint) "
            + "VALUES (?, ?, 'd1', 'Guía.pdf', 'application/pdf', 'PDF', true, '61.12', '61.12', 'PUBLISHED', ?, 'fp1')",
            UUID.randomUUID(), source, text);
        jdbc.update("UPDATE wiki.kb_model SET last_probe = '{\"ok\":true,\"mode\":\"sync\"}'::jsonb");
        var fake = (FakeSyncChatClient) syncClient;
        fake.respond(KbFakeAnswers.responder(json, false));

        var set = call(post("/v1/staff/kb/evals/sets"), "{\"name\": \"Kick\", \"subjectIds\": [\"61.12\"]}", 201);
        long t0 = System.nanoTime();
        var eval = call(post("/v1/staff/kb/evals"), "{\"setId\": \"" + set.path("id").asText()
            + "\", \"models\": [{\"plan\": \"glm-5.3\", \"write\": \"glm-5.3\"}]}", 202);
        var done = await("/v1/staff/kb/evals/" + eval.path("id").asText());
        assertThat(done.path("status").asText()).as(done.toString()).isEqualTo("SUCCEEDED");
        assertThat(fake.received()).isNotEmpty();
        assertThat((System.nanoTime() - t0) / 1_000_000_000).isLessThan(15);

        var dry = call(post("/v1/staff/kb/pipeline/runs?dryRun=true"), null, 202);
        var finished = await("/v1/staff/kb/pipeline/runs/" + dry.path("id").asText());
        assertThat(finished.path("status").asText()).as(finished.toString()).isEqualTo("SUCCEEDED");
        assertThat(finished.path("stage").asText()).isEqualTo("DONE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_run WHERE lease_owner IS NOT NULL", Integer.class))
            .isZero();   // leases released
    }
}
