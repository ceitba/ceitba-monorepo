package org.ceitba.api.service.kb.eval;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KbEvalMetricsTest {

    static final String F = "11111111-1111-1111-1111-111111111111";

    static String page(String body) {
        return "---\ntitle: \"T\"\nsubject: \"61.12\"\ntype: concept\nsummary: \"S\"\nsources: [\"" + F
            + "\"]\ngenerator: test\ngenerated_at: 2026-10-02\n---\n\n" + body;
    }

    @Test
    void groundingFlagsClaimsWhoseAnchorsAreNotInTheSources() {
        var source = "La TIR es la tasa que anula el VAN. Ejemplo: tasa de 12% anual.";
        var g = KbEvalMetrics.grounding("""
            ## Tasa
            La TIR anula el VAN [[file:%s]].
            El ejemplo usa una tasa del 12 por ciento.
            Según Fisher la tasa real es 7.5 por ciento.
            Esto es una idea general sin datos.
            """.formatted(F), source);
        assertThat(g[0]).isEqualTo(3);   // TIR/VAN, 12, Fisher/7.5 (heading has no anchors)
        assertThat(g[1]).isEqualTo(1);   // Fisher / 7.5 unsupported
    }

    @Test
    void computeCountsValidityCitationsAndEmptyToolCalls() {
        var good = page("## A\nTexto propio [[file:" + F + "]].\n");
        var bad = page("## A\nSin cita.\n");
        var pages = List.of(
            new KbEvalMetrics.PageInput("a", good, List.of(), 0, null, List.of(), "texto"),
            new KbEvalMetrics.PageInput("b", bad, List.of("section 'A' has no [[file:...]] citation"), 1, good,
                List.of(), "texto"),
            new KbEvalMetrics.PageInput("c", null, List.of("no answer from the model: x"), 0, null, List.of(), ""));
        var m = KbEvalMetrics.compute(pages, 3, new KbEvalMetrics.Usage(1000, 200, new BigDecimal("0.02"), 4, 1),
            30L, new ObjectMapper());
        assertThat(m.path("pagesPlanned").asInt()).isEqualTo(3);
        assertThat(m.path("pagesWritten").asInt()).isEqualTo(2);
        assertThat(m.path("validPages").asInt()).isEqualTo(2);
        assertThat(m.path("firstPassValidRate").asDouble()).isEqualTo(0.5);
        assertThat(m.path("uncitedSections").asInt()).isEqualTo(1);
        assertThat(m.path("coverageViolations").asInt()).isEqualTo(1);
        assertThat(m.path("rejectReasons").path("uncited_section").asInt()).isEqualTo(1);
        assertThat(m.path("rejectReasons").path("no_answer").asInt()).isEqualTo(1);
        assertThat(m.path("emptyToolCallRate").asDouble()).isEqualTo(0.25);
        assertThat(m.path("costPerValidPage").decimalValue()).isEqualByComparingTo("0.01");
    }

    @Test
    void configKeysCarryEfforts() {
        assertThat(KbEvalService.configKey("glm-5.3", "low", "glm-5.3", "medium")).isEqualTo("glm-5.3@low|glm-5.3@medium");
        assertThat(KbEvalService.configKey("a", null, "b", null)).isEqualTo("a|b");
        assertThat(KbEvalService.pageKey(java.util.UUID.fromString(F), "glm-5.3@low|glm-5.3", "61.12", "tir"))
            .isEqualTo("kb/evals/" + F + "/glm-5.3_at_low__glm-5.3/61.12/tir.md");
    }
}
