package org.ceitba.api.service.kb;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class KbMustCoverTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void normalizeTrimsCapsAndTurnsInvalidIntoEmpty() throws Exception {
        var items = json.createArrayNode();
        items.add("  a  ").add("").add(5).add("x".repeat(400));
        for (int i = 0; i < 12; i++) items.add("i" + i);
        var out = KbMustCover.normalize(items);
        assertThat(out).hasSize(KbMustCover.MAX_ITEMS);
        assertThat(out.get(0).asText()).isEqualTo("a");
        assertThat(out.get(1).asText()).hasSize(KbMustCover.MAX_CHARS);
        assertThat(KbMustCover.normalize(json.readTree("\"nope\""))).isEmpty();
        assertThat(KbMustCover.normalize(null)).isEmpty();
    }

    @Test
    void missingFormulaOnlyWhenLatexIsRequiredAndThePageHasNoMath() throws Exception {
        var latex = json.readTree("[\"Definición\", \"IC: \\\\bar X \\\\pm t\"]");
        assertThat(KbMustCover.missingFormulaErrors(latex, "Texto sin fórmulas")).singleElement()
            .asString().startsWith("missing_formula: the plan required formulas (IC: \\bar X \\pm t)");
        assertThat(KbMustCover.missingFormulaErrors(latex, "Media $\\bar X$ aquí")).isEmpty();
        assertThat(KbMustCover.missingFormulaErrors(json.readTree("[\"Definición de media\"]"), "sin math")).isEmpty();
    }
}
