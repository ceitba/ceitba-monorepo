package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.domain.kb.KbModel;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// lastProbe per mode; selectable by the mode a stage would use; a pending
// batch probe never blocks selection.
class KbProbeSelectionTest {

    final ObjectMapper json = new ObjectMapper();

    ObjectNode probe(String mode, boolean ok, boolean pending) {
        var p = json.createObjectNode().put("mode", mode).put("ok", ok).put("toolCalling", ok ? "yes" : "no");
        if (pending) p.put("pending", true);
        return p;
    }

    @Test
    void probesAreKeptPerModeWithTheLatestOnTop() {
        var afterSync = KbModelCatalogService.mergeProbe(null, probe("sync", true, false));
        var afterBatch = KbModelCatalogService.mergeProbe(afterSync, probe("batch", false, true));
        assertThat(afterBatch.path("mode").asText()).isEqualTo("batch");          // most recent on top
        assertThat(afterBatch.path("pending").asBoolean()).isTrue();
        assertThat(afterBatch.path("sync").path("ok").asBoolean()).isTrue();
        assertThat(afterBatch.path("batch").path("pending").asBoolean()).isTrue();
        assertThat(afterBatch.path("batch").has("sync")).isFalse();
        // A legacy single entry counts for its own mode.
        var legacy = json.createObjectNode().put("mode", "sync").put("ok", true);
        var merged = KbModelCatalogService.mergeProbe(legacy, probe("batch", true, false));
        assertThat(merged.path("sync").path("ok").asBoolean()).isTrue();
        assertThat(merged.path("batch").path("ok").asBoolean()).isTrue();
    }

    @Test
    void selectableFollowsTheStageMode() {
        var luna = new KbModel("openai-gpt-6-luna", "Luna", "openai", true, true);
        assertThat(luna.modeFor("auto")).isEqualTo("BATCH");
        assertThat(luna.modeFor("sync")).isEqualTo("SYNC");
        luna.setLastProbe(KbModelCatalogService.mergeProbe(
            KbModelCatalogService.mergeProbe(null, probe("sync", true, false)), probe("batch", false, true)));
        assertThat(luna.selectableIn("BATCH")).isTrue();    // pending batch probe: the sync probe decides
        assertThat(luna.selectableIn("SYNC")).isTrue();
        luna.setLastProbe(KbModelCatalogService.mergeProbe(luna.getLastProbe(), probe("batch", false, false)));
        assertThat(luna.selectableIn("BATCH")).isFalse();   // batch probe failed
        assertThat(luna.selectableIn("SYNC")).isTrue();

        var glm = new KbModel("glm-5.3", "GLM", "zhipu", false, true);
        assertThat(glm.modeFor("auto")).isEqualTo("SYNC");
        glm.setLastProbe(KbModelCatalogService.mergeProbe(null, probe("sync", true, false)));
        assertThat(glm.selectableIn(glm.modeFor("auto"))).isTrue();
        glm.setEnabled(false);
        assertThat(glm.selectableIn("SYNC")).isFalse();
        assertThat(new KbModel("x", "x", "x", false, true).selectableIn("SYNC")).isFalse();
    }
}
