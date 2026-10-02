package org.ceitba.api.service.kb;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

class KbCopyDetectorTest {

    static String words(int from, int n) {
        return IntStream.range(from, from + n).mapToObj(i -> "palabra" + i).collect(Collectors.joining(" "));
    }

    @Test
    void fortyConsecutiveWordsAreACopyThirtyNineAreNot() {
        var source = "Intro. " + words(0, 100) + " fin.";
        assertThat(KbCopyDetector.findCopy("Arranque " + words(10, 39) + " otra cosa", List.of(source))).isNull();
        assertThat(KbCopyDetector.findCopy("Arranque " + words(10, 40) + " otra cosa", List.of(source))).isNotNull();
    }

    @Test
    void formattingDoesNotHideACopy() {
        var source = words(0, 60);
        var page = "**" + words(0, 20).toUpperCase() + "**,\n\n  _" + words(20, 20) + "_ [[file:x|cita]]";
        assertThat(KbCopyDetector.findCopy(page, List.of(source))).isNotNull();
        assertThat(KbCopyDetector.findCopy(page, java.util.Arrays.asList((String) null))).isNull();
    }
}
