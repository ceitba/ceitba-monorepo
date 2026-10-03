package org.ceitba.api.web.kb.pipeline;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

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

    // Reasoning effort reaches the wire for GLM (supportsReasoningEffort).
    @Test
    void reasoningEffortIsSent() throws Exception {
        run();
        assertThat(fakeSync().received()).isNotEmpty()
            .allSatisfy(r -> assertThat(r.raw().path("reasoning_effort").asText()).isIn("low", "medium"));
    }
}
