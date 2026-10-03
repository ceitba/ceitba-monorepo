package org.ceitba.api.web.kb.pipeline;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

// Acceptance against the sync executor (GLM models, chat completions).
@TestPropertySource(properties = "kb.llm.execution-mode=sync")
class SyncPipelineIT extends KbPipelineAcceptanceIT {

    @Override
    String expectedMode() {
        return "SYNC";
    }

    // Models that ignore tool_choice: the json_object fallback still yields pages.
    @Test
    void jsonObjectFallback() throws Exception {
        fakeSync().proseUnlessJsonObject(true);
        var run = run();
        assertThat(run.path("status").asText()).as(run.toString()).isEqualTo("SUCCEEDED");
        assertThat(publishedSlugs(FIN)).containsExactly("conceptos-centrales");
    }

    // Every HTTP call is a usage row with its attempt number and latency;
    // the run's progress is complete.
    @Test
    void usageRowsCarryAttemptAndLatency() throws Exception {
        var run = run();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_llm_usage WHERE latency_ms IS NULL", Integer.class))
            .isZero();
        assertThat(jdbc.queryForList("SELECT DISTINCT attempt FROM wiki.kb_llm_usage", Integer.class)).containsOnly(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_run_request WHERE status = 'DONE' "
            + "AND (completed_at IS NULL OR latency_ms IS NULL)", Integer.class)).isZero();
        var p = call(get("/v1/staff/kb/pipeline/runs/" + run.path("id").asText() + "/progress"), null, 200);
        assertThat(p.path("overall").path("percent").asDouble()).isEqualTo(100.0);
        assertThat(p.path("stages").get(0).path("mode").asText()).isEqualTo("sync");
        assertThat(run.path("progress").path("current").asText()).isEqualTo("Terminado");
        // Stage transitions were logged into stage_log.
        assertThat(jdbc.queryForObject("SELECT stage_log::text FROM wiki.kb_run WHERE id = ?::uuid", String.class,
            run.path("id").asText())).contains("DIGEST", "finishedAt");
    }

    // Reasoning effort reaches the wire for GLM (supportsReasoningEffort).
    @Test
    void reasoningEffortIsSent() throws Exception {
        run();
        assertThat(fakeSync().received()).isNotEmpty()
            .allSatisfy(r -> assertThat(r.raw().path("reasoning_effort").asText()).isIn("low", "medium"));
    }
}
