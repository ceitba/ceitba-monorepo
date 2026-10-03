package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class KbWikilinksTest {

    @Test
    void classifiesTargets() {
        var p = KbWikilinks.parse("[[van-y-tir]] [[van-y-tir|VAN]] [[81.07/balance|b]] [[81.07]] [[93.41A]] "
            + "[[file:11111111-1111-1111-1111-111111111111|x]] `[[en-codigo]]`\n```\n[[en-bloque]]\n```", "61.12");
        assertThat(p.links()).containsExactly(
            new KbWikilinks.PageLink("van-y-tir", "61.12", "van-y-tir", null),
            new KbWikilinks.PageLink("81.07/balance", "81.07", "balance", null),
            new KbWikilinks.PageLink("81.07", "81.07", "index", null),
            new KbWikilinks.PageLink("93.41A", "93.41A", "index", null));
        assertThat(p.citations()).hasSize(1);
        assertThat(p.citations().get(0).id()).isNotNull();
    }

    @Test
    void anchors() {
        var p = KbWikilinks.parse("[[van-y-tir#Cómo se calcula|x]] [[81.07/balance#activo]] [[#Tasa efectiva]] "
            + "[[81.07#Temas]]", "61.12", "vtd");
        assertThat(p.links()).containsExactly(
            new KbWikilinks.PageLink("van-y-tir#Cómo se calcula", "61.12", "van-y-tir", "como-se-calcula"),
            new KbWikilinks.PageLink("81.07/balance#activo", "81.07", "balance", "activo"),
            new KbWikilinks.PageLink("#Tasa efectiva", "61.12", "vtd", "tasa-efectiva"),
            new KbWikilinks.PageLink("81.07#Temas", "81.07", "index", "temas"));
        assertThat(KbWikilinks.anchor("  ¿Qué es el VAN? (2da parte)  ")).isEqualTo("que-es-el-van-2da-parte");
        assertThat(KbWikilinks.headingAnchors("# Título\n## Cómo se calcula\n### Paso 2 ##\n#### Con [[vtd|VTD]]\n"
            + "##### muy profundo\n```\n## en código\n```"))
            .containsExactly("como-se-calcula", "paso-2", "con-vtd");
    }
}
