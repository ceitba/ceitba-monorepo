package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class KbValidatorTest {

    static final UUID F1 = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final UUID F2 = UUID.fromString("22222222-2222-2222-2222-222222222222");

    static KbPageParser.Draft draft(String sources, String body) {
        var content = "---\ntitle: T\nsubject: \"61.12\"\ntype: concept\nsummary: S\nsources: [" + sources
            + "]\ngenerator: manual\ngenerated_at: 2026-10-02\n---\n" + body;
        var r = KbPageParser.parse("t.md", content, "61.12");
        assertThat(r.errors()).isEmpty();
        return r.draft();
    }

    @Test
    void sourcesMustBePublishedFilesOfTheSubjectAndCitedFilesListed() {
        var d = draft(F1 + ", " + F2, "## A\n[[file:" + F1 + "]] [[file:33333333-3333-3333-3333-333333333333]]");
        var errors = KbValidator.validate(d, Map.of(
            F1, new KbValidator.SourceInfo(F1, true, "61.12", "texto"),
            F2, new KbValidator.SourceInfo(F2, false, "61.12", "texto")));
        assertThat(errors).containsExactly(
            "cites file 33333333-3333-3333-3333-333333333333 which is not in sources",
            "source " + F2 + " is not a published file");

        assertThat(KbValidator.validate(draft(F1.toString(), "## A\n[[file:" + F1 + "]]"),
            Map.of(F1, new KbValidator.SourceInfo(F1, true, "93.41", "x"))))
            .containsExactly("source " + F1 + " is not a file of subject 61.12");
        assertThat(KbValidator.validate(draft(F1.toString(), "## A\n[[file:" + F1 + "]]"), Map.of()))
            .containsExactly("source " + F1 + " does not exist");
        assertThat(KbValidator.validate(draft(F1.toString(), "## A\n[[file:" + F1 + "]]"),
            Map.of(F1, new KbValidator.SourceInfo(F1, true, "61.12", "x")))).isEmpty();
    }

    @Test
    void copiesFromASourceAreRejected() {
        var text = KbCopyDetectorTest.words(0, 80);
        var d = draft(F1.toString(), "## A\n" + KbCopyDetectorTest.words(5, 45) + " [[file:" + F1 + "]]");
        assertThat(KbValidator.validate(d, Map.of(F1, new KbValidator.SourceInfo(F1, true, "61.12", text))))
            .singleElement().asString().startsWith("copies 40+ consecutive words");
    }

    static java.util.List<String> parseErrors(String body) {
        var content = "---\ntitle: T\nsubject: \"61.12\"\ntype: concept\nsummary: S\nsources: [" + F1
            + "]\ngenerator: manual\ngenerated_at: 2026-10-02\n---\n" + body;
        return KbPageParser.parse("t.md", content, "61.12").errors();
    }

    static final String CITE = " [[file:" + F1 + "|a.pdf]]";

    @Test
    void goodMathAndProseAreAccepted() {
        assertThat(parseErrors("## A\nLa media $\\bar{X}$ y $$\\frac{a}{b} \\\\ c$$ cuestan \\$5. Usa `\\bar` en código."
            + CITE + "\n\n```\n\\\\bar $\n```\n\n## Pendiente de la curva\nLa pendiente es negativa." + CITE
            + "\n\nVer [[t#a]] y [[#a]]. Todo el mercado compite." + CITE)).isEmpty();
    }

    @Test
    void brokenLatexIsRejected() {
        for (var bad : new String[] {
            "## A\nLa media \\bar{X} es.",
            "## A\nLa media \\\\bar{X} es.",
            "## A\n$\\bar{X} \\\n\\pm z$ es.",
            "## A\nUn precio de $5 y nada más.",
            "## A\nSe ve $\\\\pm z$ aquí."}) {
            assertThat(parseErrors(bad + CITE)).as(bad).anyMatch(e -> e.startsWith("latex_format:"));
        }
    }

    @Test
    void editorNotesAreRejected() {
        for (var bad : new String[] {
            "## Qué falta\n- Algo" + CITE, "## Contenido\nTexto" + CITE + "\n\n## TODO\nx",
            "## A\nTexto" + CITE + "\n- Agregar enlaces a páginas de cada tema cuando existan",
            "## A\nTexto" + CITE + "\n- TODO: ampliar", "## A\nTexto" + CITE + "\n- Por completar"}) {
            assertThat(parseErrors(bad)).as(bad).anyMatch(e -> e.startsWith("meta_section:"));
        }
    }

    @Test
    void selfLinksAndSpacedCitationsAreRejected() {
        assertThat(parseErrors("## A\nVer [[t|Esta]]" + CITE)).anyMatch(e -> e.startsWith("self_link:"));
        assertThat(parseErrors("## A\nTexto [[file: " + F1 + "|a.pdf]]")).anyMatch(e -> e.startsWith("citation "));
    }
}
