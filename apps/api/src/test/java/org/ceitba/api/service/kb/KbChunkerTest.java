package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class KbChunkerTest {

    static final String FILE = "[[file:3f2b1c9e-0000-4000-8000-000000000001]]";

    @Test
    void chunk0IsTitleSummaryAndIntroThenOneChunkPerSection() {
        var md = """
            Intro con [[valor-actual|valor actual]].

            ## Cómo se calcula
            Se descuenta cada flujo %s.

            ### Ejemplo
            Un ejemplo con [[61.12/tasa]].

            ## Usos
            En [[61.12|Financiera]] se usa mucho %s.
            """.formatted(FILE, FILE);
        var chunks = KbChunker.chunk("VAN", "El valor actual neto.", md);

        assertThat(chunks).hasSize(3);
        assertThat(chunks.get(0).ordinal()).isZero();
        assertThat(chunks.get(0).heading()).isNull();
        assertThat(chunks.get(0).anchor()).isNull();
        assertThat(chunks.get(0).title()).isEqualTo("VAN");
        assertThat(chunks.get(0).body()).isEqualTo("El valor actual neto.\n\nIntro con valor actual.");
        assertThat(chunks.get(0).text()).isEqualTo("VAN\n\nEl valor actual neto.\n\nIntro con valor actual.");

        assertThat(chunks.get(1).heading()).isEqualTo("Cómo se calcula");
        assertThat(chunks.get(1).anchor()).isEqualTo("como-se-calcula");
        // ### stays inside its ## section; wikilinks become text, bare citations go.
        assertThat(chunks.get(1).title()).isEqualTo("VAN — Cómo se calcula");
        assertThat(chunks.get(1).body()).isEqualTo("Se descuenta cada flujo .\n\n### Ejemplo\nUn ejemplo con 61.12/tasa.");

        assertThat(chunks.get(2).ordinal()).isEqualTo(2);
        assertThat(chunks.get(2).text()).isEqualTo("VAN — Usos\n\nEn Financiera se usa mucho .");
    }

    @Test
    void headingsInsideCodeFencesDoNotSplit() {
        var md = """
            ## Código
            ```
            ## no es un título
            ```
            """;
        var chunks = KbChunker.chunk("T", "S", md);
        assertThat(chunks).hasSize(2);
        assertThat(chunks.get(1).text()).contains("## no es un título");
    }

    @Test
    void emptySectionsAreSkippedButChunk0AlwaysExists() {
        var chunks = KbChunker.chunk("T", "S", "## Vacía\n\n## Llena\nTexto.\n");
        assertThat(chunks).extracting(KbChunker.Chunk::heading).containsExactly(null, "Llena");
        assertThat(chunks.get(0).text()).isEqualTo("T\n\nS");
        assertThat(chunks).extracting(KbChunker.Chunk::ordinal).containsExactly(0, 1);
    }

    @Test
    void longSectionsAreSplitAtParagraphsWithinTheLimit() {
        var para = "palabra ".repeat(400).strip();          // ~3.2k chars
        var md = "## Larga\n" + para + "\n\n" + para + "\n\n" + para + "\n";
        var chunks = KbChunker.chunk("T", "S", md);

        var parts = chunks.subList(1, chunks.size());
        assertThat(parts).hasSize(3);
        assertThat(parts).allSatisfy(c -> {
            assertThat(c.title()).isEqualTo("T — Larga");
            assertThat(c.text().length()).isLessThanOrEqualTo(KbChunker.MAX_CHARS);
            assertThat(c.anchor()).isEqualTo("larga");
        });
    }

    @Test
    void aParagraphLongerThanTheLimitIsHardCut() {
        var md = "## X\n" + "a".repeat(KbChunker.MAX_CHARS * 2) + "\n";
        var parts = KbChunker.chunk("T", "S", md).subList(1, 4);
        assertThat(parts).allSatisfy(c -> assertThat(c.text().length()).isLessThanOrEqualTo(KbChunker.MAX_CHARS));
    }
}
