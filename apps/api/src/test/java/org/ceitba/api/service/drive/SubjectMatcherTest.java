package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SubjectMatcherTest {

    final SubjectMatcher matcher = new SubjectMatcher(Map.of(
        "93.41", "Física I",
        "93.42", "Física II",
        "93.26", "Análisis Matemático I",
        "93.27", "Análisis Matemático II",
        "93.59", "Matemática I",
        "93.61", "Matemática Discreta",
        "72.34", "Estructuras de Datos y Algoritmos",
        "94.21", "Comunicación"));

    @Test
    void matchesNamesAccentAndCaseInsensitively() {
        assertThat(matcher.match("FISICA I")).contains("93.41");
        assertThat(matcher.match("Física 2 - parciales")).contains("93.42");
        assertThat(matcher.match("fisica 1")).contains("93.41");
        assertThat(matcher.match("Analisis Matematico II (2024)")).contains("93.27");
        assertThat(matcher.match("comunicacion")).contains("94.21");
        assertThat(matcher.match("Estructuras de datos y algoritmos - resumen")).contains("72.34");
    }

    @Test
    void prefersTheMoreSpecificSubject() {
        assertThat(matcher.match("Matemática Discreta")).contains("93.61");
        assertThat(matcher.match("Matematica 1")).contains("93.59");
    }

    @Test
    void codesWin() {
        assertThat(matcher.match("93.42 apuntes")).contains("93.42");
        assertThat(matcher.match("TP 93-26")).contains("93.26");
        assertThat(matcher.match("9341_resumen")).contains("93.41");
        assertThat(matcher.match("12.34 unknown code")).isEmpty();
    }

    @Test
    void noMatchBelowThreshold() {
        assertThat(matcher.match("Física")).isEmpty();
        assertThat(matcher.match("Analisis Matematico")).isEmpty();
        assertThat(matcher.match("Parcial 1")).isEmpty();
        assertThat(matcher.match("Varios")).isEmpty();
        assertThat(matcher.match("")).isEmpty();
        assertThat(matcher.match(null)).isEmpty();
    }
}
