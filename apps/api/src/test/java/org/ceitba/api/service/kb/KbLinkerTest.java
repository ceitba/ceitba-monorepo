package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// Deterministic linker (port of scripts/kb/link_kb.py).
class KbLinkerTest {

    static final List<KbLinker.Target> PAGES = List.of(
        new KbLinker.Target("tasa-interna-de-retorno", "Tasa interna de retorno", List.of("TIR")),
        new KbLinker.Target("valor-actual-neto", "Valor actual neto", List.of()));

    @Test
    void linksTheFirstMentionPerSectionAndSkipsCodeAndHeadings() {
        var body = """
            ## Valor actual neto
            El valor actual neto se compara con la tasa interna de retorno.
            Otra vez la tasa interna de retorno.

            `tasa interna de retorno`
            """;
        var r = KbLinker.link(body, "otra", PAGES);
        assertThat(r.body()).contains("[[tasa-interna-de-retorno|tasa interna de retorno]] de retorno.".replace(" de retorno.", ""))
            .contains("## Valor actual neto\n")
            .contains("`tasa interna de retorno`")
            .contains("[[valor-actual-neto|valor actual neto]]");
        assertThat(r.body().split("\\[\\[tasa-interna-de-retorno", -1)).hasSize(2);
        assertThat(r.addedSlugs()).contains("tasa-interna-de-retorno", "valor-actual-neto");
    }

    @Test
    void doesNotLinkTheCurrentPageAndReportsUnlinkedMentions() {
        var body = "## A\nLa tasa interna de retorno importa.\n";
        assertThat(KbLinker.link(body, "tasa-interna-de-retorno", PAGES).body()).isEqualTo(body);
        assertThat(KbLinker.unlinked(body, "x", PAGES)).extracting(KbLinker.Mention::slug)
            .containsExactly("tasa-interna-de-retorno");
        var linked = "## A\nLa [[tasa-interna-de-retorno|TIR]] importa.\n";
        assertThat(KbLinker.unlinked(linked, "x", PAGES)).isEmpty();
    }
}
