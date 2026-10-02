package org.ceitba.api.service.kb;

import org.ceitba.api.domain.kb.KbPageType;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class KbPageParserTest {

    static final String F1 = "11111111-1111-1111-1111-111111111111";

    static String page(String frontmatter, String body) {
        return "---\n" + frontmatter + "\n---\n" + body;
    }

    static String fm(String subject, String type) {
        return "title: Valor tiempo del dinero\nsubject: " + subject + "\ntype: " + type
            + "\nsummary: Resumen.\naliases: [VTD]\nsources: [" + F1 + "]\ngenerator: claude-opus-5.5/manual\n"
            + "generated_at: 2026-10-02";
    }

    static final String BODY = "Intro [[van-y-tir]].\n\n## Interés\nTexto [[file:" + F1 + "|guía]].\n\n"
        + "### Sub\nmás\n\n## Descuento\nVer [[81.07/balance|balance]] y [[81.07]] [[file:" + F1 + "]].\n";

    @Test
    void parsesAValidPage() {
        var r = KbPageParser.parse("valor-tiempo-del-dinero.md", page(fm("\"61.12\"", "concept"), BODY), "61.12");
        assertThat(r.errors()).isEmpty();
        var d = r.draft();
        assertThat(d.slug()).isEqualTo("valor-tiempo-del-dinero");
        assertThat(d.type()).isEqualTo(KbPageType.CONCEPT);
        assertThat(d.aliases()).containsExactly("VTD");
        assertThat(d.sources()).containsExactly(UUID.fromString(F1));
        assertThat(d.generatedAt().toLocalDate().toString()).isEqualTo("2026-10-02");
        assertThat(d.body()).startsWith("Intro").doesNotContain("---");
        assertThat(d.links().links()).extracting(KbWikilinks.PageLink::raw)
            .containsExactly("van-y-tir", "81.07/balance", "81.07");
        assertThat(d.links().citations()).hasSize(2);
    }

    @Test
    void rejectsBadFrontmatterAndStructure() {
        assertThat(KbPageParser.parse("a.md", "no frontmatter", "61.12").errors())
            .anyMatch(e -> e.contains("missing frontmatter"));
        assertThat(KbPageParser.parse("a.md", "---\ntitle: x\n", "61.12").errors())
            .anyMatch(e -> e.contains("not closed"));
        // Unquoted subject parses as a number.
        assertThat(KbPageParser.parse("a.md", page(fm("61.12", "concept"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("quoted string"));
        assertThat(KbPageParser.parse("a.md", page(fm("\"61.13\"", "concept"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("does not match the folder"));
        assertThat(KbPageParser.parse("a.md", page(fm("\"61.12\"", "index"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("only for index.md"));
        assertThat(KbPageParser.parse("index.md", page(fm("\"61.12\"", "topic"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("must have type: index"));
        assertThat(KbPageParser.parse("Mal_Slug.md", page(fm("\"61.12\"", "concept"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("invalid slug"));
        assertThat(KbPageParser.parse("graph.md", page(fm("\"61.12\"", "concept"), BODY), "61.12").errors())
            .anyMatch(e -> e.contains("reserved"));
        assertThat(KbPageParser.parse("a.md", page("title: x\nsubject: \"61.12\"\ntype: concept", BODY), "61.12").errors())
            .anyMatch(e -> e.contains("summary is required"))
            .anyMatch(e -> e.contains("sources is required"))
            .anyMatch(e -> e.contains("generated_at is required"));
    }

    @Test
    void everyH2SectionNeedsACitation() {
        var body = "## Uno\nsin cita\n### Sub\n[[file:" + F1 + "]]\n## Dos\n```\n## no es heading\n```\nnada\n";
        var r = KbPageParser.parse("a.md", page(fm("\"61.12\"", "concept"), body), "61.12");
        assertThat(r.errors()).containsExactly("section 'Dos' has no [[file:…]] citation");
        // A citation inside a code block does not count.
        var code = "## Uno\n`[[file:" + F1 + "]]`\n";
        assertThat(KbPageParser.parse("a.md", page(fm("\"61.12\"", "concept"), code), "61.12").errors())
            .containsExactly("section 'Uno' has no [[file:…]] citation");
        assertThat(KbPageParser.parse("a.md", page(fm("\"61.12\"", "concept"), "## Uno\n[[file:nope]]"), "61.12").errors())
            .contains("invalid citation [[file:nope]]");
    }
}
