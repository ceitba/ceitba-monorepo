package org.ceitba.api.service.kb.pipeline;

import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.service.kb.llm.KbChatPayloads;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.service.kb.pipeline.KbAdmission.Candidate;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// Cost-based, smallest-first admission of dirty subjects into a run.
class KbAdmissionTest {

    static KbModel model(String id, String in, String out, String discount) {
        var m = new KbModel(id, id, "x", KbChatPayloads.batchByRule(id), true);
        m.setPrices(new BigDecimal(in), new BigDecimal(out), null, new BigDecimal(discount), null);
        return m;
    }

    static Candidate c(String id, String usd, long tokens) {
        return new Candidate(id, new BigDecimal(usd), tokens, null);
    }

    // Cheap DIGEST tokens (nano batch) weigh far less than WRITE tokens (sync):
    // a subject with 10x the tokens but all in DIGEST costs less, so it is
    // admitted where the small, WRITE-heavy one is not.
    @Test
    void admissionIsByMoneyNotTokens() {
        var nano = model("gpt-5-nano", "0.05", "0.40", "0.5");   // batch: 0.025 / 0.20
        var luna = model("luna", "0.10", "0.50", "0.5");          // sync
        var huge = KbPricing.cost(nano, "BATCH", 5_000_000, 0, 400)
            .add(KbPricing.cost(luna, "SYNC", 20_000, 0, 5_000));        // ~US$ 0.13, 5M tokens
        var small = KbPricing.cost(luna, "SYNC", 3_000_000, 0, 2_000_000);   // ~US$ 1.30, 3M tokens
        assertThat(huge).isLessThan(small);
        var result = KbAdmission.admit(List.of(
            new Candidate("small-write-heavy", small, 3_000_000, null),
            new Candidate("huge-digest", huge, 5_020_000, null)), new BigDecimal("1.00"), 50_000_000);
        assertThat(result.admitted()).extracting(Candidate::subjectId).containsExactly("huge-digest");
        assertThat(result.deferred()).extracting(Candidate::subjectId).containsExactly("small-write-heavy");
        assertThat(result.oversized()).isNull();
        assertThat(result.deferredUsd()).isEqualByComparingTo(small);
    }

    @Test
    void firstCandidateAloneOverBudgetRunsAloneThenNothingElse() {
        var result = KbAdmission.admit(List.of(c("a", "7.00", 10), c("b", "9.00", 10), c("c", "12.00", 10)),
            new BigDecimal("5.00"), 50_000_000);
        assertThat(result.admitted()).extracting(Candidate::subjectId).containsExactly("a");
        assertThat(result.oversized().subjectId()).isEqualTo("a");
        assertThat(result.deferred()).extracting(Candidate::subjectId).containsExactly("b", "c");
        // A big subject behind admitted ones is just deferred (it gets its own run later).
        var mixed = KbAdmission.admit(List.of(c("a", "1.00", 10), c("big", "9.00", 10)), new BigDecimal("5.00"), 50_000_000);
        assertThat(mixed.admitted()).extracting(Candidate::subjectId).containsExactly("a");
        assertThat(mixed.oversized()).isNull();
        // The secondary token cap also applies.
        var tokens = KbAdmission.admit(List.of(c("a", "0.10", 600), c("b", "0.10", 600)), new BigDecimal("5.00"), 1000);
        assertThat(tokens.admitted()).hasSize(1);
        assertThat(tokens.deferred()).hasSize(1);
    }

    @Test
    void smallestFirstTiesBrokenByOldestDirty() {
        var t0 = OffsetDateTime.parse("2026-01-01T00:00:00Z");
        var result = KbAdmission.admit(List.of(
            c("zzz-big", "2.00", 10),
            new Candidate("recent", new BigDecimal("1.00"), 10, t0.plusDays(30)),
            new Candidate("old", new BigDecimal("1.00"), 10, t0),
            new Candidate("never-compiled", new BigDecimal("1.00"), 10, null),
            c("tiny", "0.01", 10)), new BigDecimal("100"), 50_000_000);
        assertThat(result.admitted()).extracting(Candidate::subjectId)
            .containsExactly("tiny", "never-compiled", "old", "recent", "zzz-big");
    }
}
