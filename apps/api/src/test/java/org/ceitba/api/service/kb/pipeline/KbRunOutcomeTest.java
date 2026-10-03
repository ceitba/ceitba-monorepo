package org.ceitba.api.service.kb.pipeline;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// FAILED when every config/subject failed, PARTIAL when some did, else SUCCEEDED.
class KbRunOutcomeTest {

    @Test
    void aggregatesFailures() {
        assertThat(KbRunOutcome.status(1, 1)).isEqualTo("FAILED");   // the eval with its only config failed
        assertThat(KbRunOutcome.status(3, 3)).isEqualTo("FAILED");
        assertThat(KbRunOutcome.status(3, 1)).isEqualTo("PARTIAL");
        assertThat(KbRunOutcome.status(3, 0)).isEqualTo("SUCCEEDED");
        assertThat(KbRunOutcome.status(0, 0)).isEqualTo("SUCCEEDED");   // nothing to do
    }

    @Test
    void partialCountsAsCompleted() {
        assertThat(KbRunOutcome.completed("PARTIAL")).isTrue();
        assertThat(KbRunOutcome.completed("SUCCEEDED")).isTrue();
        assertThat(KbRunOutcome.completed("FAILED")).isFalse();
        assertThat("PARTIAL".length()).isLessThanOrEqualTo(32);   // kb_run.status VARCHAR(32)
    }
}
