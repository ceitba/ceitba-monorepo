package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class KbWikilinksTest {

    @Test
    void classifiesTargets() {
        var p = KbWikilinks.parse("[[van-y-tir]] [[van-y-tir|VAN]] [[81.07/balance|b]] [[81.07]] [[93.41A]] "
            + "[[file:11111111-1111-1111-1111-111111111111|x]] `[[en-codigo]]`\n```\n[[en-bloque]]\n```", "61.12");
        assertThat(p.links()).containsExactly(
            new KbWikilinks.PageLink("van-y-tir", "61.12", "van-y-tir"),
            new KbWikilinks.PageLink("81.07/balance", "81.07", "balance"),
            new KbWikilinks.PageLink("81.07", "81.07", "index"),
            new KbWikilinks.PageLink("93.41A", "93.41A", "index"));
        assertThat(p.citations()).hasSize(1);
        assertThat(p.citations().get(0).id()).isNotNull();
    }
}
