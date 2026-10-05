package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KbDigestToleranceTest {

    final ObjectMapper json = new ObjectMapper();

    // Reasoning models get room to think on top of the answer budget, never
    // beyond the sync cap or the model's own limit, never below the configured value.
    @Test
    void reasoningHeadroom() {
        assertThat(KbPayloads.withHeadroom(4000, "low", null)).isEqualTo(8000);
        assertThat(KbPayloads.withHeadroom(4000, "medium", null)).isEqualTo(12000);
        assertThat(KbPayloads.withHeadroom(4000, null, null)).isEqualTo(12000);
        assertThat(KbPayloads.withHeadroom(4000, "high", null)).isEqualTo(20000);
        assertThat(KbPayloads.withHeadroom(20000, "high", null)).isEqualTo(32000);
        assertThat(KbPayloads.withHeadroom(4000, "high", 10000)).isEqualTo(10000);
        assertThat(KbPayloads.withHeadroom(12000, "low", 10000)).isEqualTo(12000);
    }

    // A file with a failed chunk keeps the digest of the others, flagged partial.
    @Test
    void partialChunkMerge() throws Exception {
        var ok = json.readTree("{\"topics\":[{\"name\":\"Fourier\",\"summary\":\"s\"}]}");
        var merged = KbDigests.mergePartial(Arrays.asList(ok, null, ok), json);
        assertThat(merged.path("partial").asBoolean()).isTrue();
        assertThat(merged.path("failedChunks").toString()).isEqualTo("[1]");
        assertThat(merged.path("topics")).hasSize(1);
        assertThat(KbDigests.mergePartial(List.of(ok, ok), json).has("partial")).isFalse();
    }

    // Up to 20% of a subject's files may lack a digest; more, or all, fails it.
    @Test
    void missingFilesTolerance() {
        assertThat(KbDigests.tolerableMissing(List.of("a"), 5, 0.2)).containsExactly("a");
        assertThat(KbDigests.tolerableMissing(List.of("a", "b"), 5, 0.2)).isNull();
        assertThat(KbDigests.tolerableMissing(List.of("a"), 1, 0.2)).isNull();
        assertThat(KbDigests.tolerableMissing(List.of(), 3, 0.2)).isEmpty();
    }
}
