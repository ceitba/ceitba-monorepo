package org.ceitba.api.web.kb.pipeline;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

// Acceptance against the batch executor (anthropic model, KB_EXECUTION_MODE=batch).
@TestPropertySource(properties = {
    "kb.llm.execution-mode=batch",
    "kb.pipeline.model-digest=anthropic-claude-haiku-4.5",
    "kb.pipeline.model-plan=anthropic-claude-haiku-4.5",
    "kb.pipeline.model-write=anthropic-claude-haiku-4.5"
})
class BatchPipelineIT extends KbPipelineAcceptanceIT {

    @Override
    String expectedMode() {
        return "BATCH";
    }

    // A restart while batches are in flight: the run waits, then resumes
    // from the stored state without resubmitting anything.
    @Test
    void waitsForBatchesAndResumes() throws Exception {
        fakeBatch().hold(true);
        var run = run();
        assertThat(run.path("status").asText()).isEqualTo("WAITING");
        int submitted = fakeBatch().submitted().size();
        engine.advanceActive();   // still in progress: nothing new
        assertThat(fakeBatch().submitted()).hasSize(submitted);
        fakeBatch().hold(false);
        fakeBatch().release();
        for (int i = 0; i < 6; i++) engine.advanceActive();
        var done = call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
            .get("/v1/staff/kb/pipeline/runs/" + run.path("id").asText()), null, 200);
        assertThat(done.path("status").asText()).as(done.toString()).isEqualTo("SUCCEEDED");
        assertThat(publishedSlugs(FIN)).containsExactly("conceptos-centrales");
    }
}
