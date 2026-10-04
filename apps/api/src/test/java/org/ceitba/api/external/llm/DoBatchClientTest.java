package org.ceitba.api.external.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DoBatchClientTest {

    @Test
    void batchFileNamesAlwaysEndInJsonl() {
        assertThat(DoBatchClient.jsonlFileName("probe-anthropic-claude-haiku-4.5")).isEqualTo("probe-anthropic-claude-haiku-4.5.jsonl");
        assertThat(DoBatchClient.jsonlFileName("run-1/DIGEST.jsonl")).isEqualTo("run-1-DIGEST.jsonl");
        assertThat(DoBatchClient.jsonlFileName(" ")).isEqualTo("batch.jsonl");
        assertThat(DoBatchClient.jsonlFileName(null)).isEqualTo("batch.jsonl");
    }

    @Test
    void completedWithoutResultsYetIsStillFinalizing() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        var early = DoBatchClient.info(json.readTree("{\"batch_id\":\"b\",\"status\":\"completed\",\"result_available\":false}"));
        assertThat(early.status()).isEqualTo("finalizing");
        assertThat(early.finished()).isFalse();
        var ready = DoBatchClient.info(json.readTree("{\"batch_id\":\"b\",\"status\":\"completed\",\"result_available\":true}"));
        assertThat(ready.finished()).isTrue();
    }
}
