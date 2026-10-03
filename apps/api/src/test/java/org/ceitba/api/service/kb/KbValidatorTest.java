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
}
