package org.ceitba.api.service.kb.pipeline;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class KbPlanCheckTest {

    @Test
    void indexOnlyPlanIsInsufficientOnFirstCompileWithSeveralSources() {
        var check = new KbPlanCheck(new com.fasterxml.jackson.databind.ObjectMapper().createArrayNode().add("x"));
        check.firstCompile(2);
        check.keptPage("index");
        assertThat(check.indexOnly()).isTrue();
        check.keptPage("media-muestral");
        assertThat(check.indexOnly()).isFalse();

        var single = new KbPlanCheck(null);
        single.firstCompile(1);
        single.keptPage("index");
        assertThat(single.insufficient()).isFalse();
        assertThat(KbPlanCheck.normalizeIndexSlug("Índice", "index")).isEqualTo("index");
        assertThat(KbPlanCheck.normalizeIndexSlug("indice", "concept")).isEqualTo("indice");
    }
}
