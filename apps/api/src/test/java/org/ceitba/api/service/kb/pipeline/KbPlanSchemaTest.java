package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KbPlanSchemaTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void planOperationsRequireEveryFieldAndDescribeSources() {
        var tool = new KbPayloads(json, null).tool("plan");
        var op = tool.path("input_schema").path("properties").path("operations").path("items");
        var required = new ArrayList<String>();
        op.path("required").forEach(n -> required.add(n.asText()));
        assertThat(required).containsExactlyInAnyOrder("op", "slug", "type", "title", "sources", "reason");
        assertThat(op.path("properties").path("sources").path("description").asText()).contains("exactly as given");
    }

    @Test
    void retriesOnlyWhenTheModelProposedOperationsAndNoneWasKept() throws Exception {
        var proposed = json.readTree("[{\"op\":\"create\",\"slug\":\"teorema-central-limite\",\"type\":\"concept\"}]");
        var check = new KbPlanCheck(proposed);
        check.droppedForSources(proposed.get(0).path("sources"));
        assertThat(check.emptyAfterFiltering()).isTrue();
        assertThat(check.droppedByReason()).containsEntry(KbPlanCheck.NO_SOURCES, 1);

        assertThat(new KbPlanCheck(json.createArrayNode()).emptyAfterFiltering()).isFalse();   // nothing to change
        var some = new KbPlanCheck(proposed);
        some.kept();
        assertThat(some.emptyAfterFiltering()).isFalse();
    }

    @Test
    void correctionIsAppendedToTheUserMessage() {
        var payloads = new KbPayloads(json, null);
        var params = payloads.params("m", "plan", 1000, "stable", "variable");
        var redo = payloads.withNote(params, KbPlanCheck.correction(List.of("id-1", "id-2")));
        var content = redo.path("messages").get(0).path("content");
        assertThat(content).hasSize(3);
        assertThat(content.get(2).path("text").asText()).contains("id-1, id-2");
        assertThat(params.path("messages").get(0).path("content")).hasSize(2);   // original untouched
    }
}
