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
}
