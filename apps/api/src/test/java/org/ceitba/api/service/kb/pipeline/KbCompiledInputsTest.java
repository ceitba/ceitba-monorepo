package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

// After PUBLISH only the inputs of pages that made it in count as compiled:
// a failed page's sources keep their previous version (or stay new), and a
// removed file it still cites stays recorded, so the next run redoes them.
class KbCompiledInputsTest {

    final ObjectMapper json = new ObjectMapper();

    @Test
    void failedPagesLeaveTheirInputsDirty() throws Exception {
        var previous = json.readTree("""
            [{"fileId":"a","fingerprint":"a1"},{"fileId":"b","fingerprint":"b1"},{"fileId":"x","fingerprint":"x1"}]""");
        var current = json.readTree("""
            [{"fileId":"a","fingerprint":"a2"},{"fileId":"b","fingerprint":"b2"},{"fileId":"c","fingerprint":"c1"}]""");
        // The page drawing on b and c (and citing the removed x) was rejected.
        var compiled = KbPipelineService.compiledInputs(previous, current, Set.of("b", "c", "x"), json);
        assertThat(compiled.toString()).isEqualTo(
            "[{\"fileId\":\"a\",\"fingerprint\":\"a2\"},{\"fileId\":\"b\",\"fingerprint\":\"b1\"},"
                + "{\"fileId\":\"x\",\"fingerprint\":\"x1\"}]");
        // Nothing failed: exactly the current inputs.
        assertThat(KbPipelineService.compiledInputs(previous, current, Set.of(), json)).isEqualTo(current);
    }
}
