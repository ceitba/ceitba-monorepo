package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// Real folder/file names from a student's Drive, with plan A22 (Analítica
// Empresarial y Social) plus subjects outside it.
class PlanAwareSubjectMatcherTest {

    static final Map<String, String> SUBJECTS = new LinkedHashMap<>();
    static {
        // A22
        SUBJECTS.put("71.80", "Utilitarios en Informática");
        SUBJECTS.put("81.06", "Introducción a la Administración");
        SUBJECTS.put("93.20", "Análisis Matemático");
        SUBJECTS.put("93.21", "Álgebra");
        SUBJECTS.put("71.20", "Informática General");
        SUBJECTS.put("82.15", "Matemática Aplicada");
        SUBJECTS.put("93.16", "Matemática Discreta");
        SUBJECTS.put("94.24", "Metodología del Aprendizaje");
        SUBJECTS.put("93.24", "Probabilidad y Estadística");
        // Not in A22
        SUBJECTS.put("93.41", "Física I");
        SUBJECTS.put("93.42", "Física II");
        SUBJECTS.put("93.04", "Química");
        SUBJECTS.put("94.21", "Comunicación");
        SUBJECTS.put("72.34", "Estructuras de Datos y Algoritmos");
        SUBJECTS.put("72.37", "Base de Datos I");
        SUBJECTS.put("93.59", "Matemática I");
    }

    // Plan order (year, semester).
    static final List<String> A22 = List.of("93.20", "93.21", "71.80", "81.06", "82.15", "71.20", "93.16", "94.24", "93.24");

    final SubjectMatcher withPlan = new SubjectMatcher(SUBJECTS, A22);
    final SubjectMatcher withoutPlan = new SubjectMatcher(SUBJECTS);

    @Test
    void realNamesWithThePlan() {
        assertThat(withPlan.match("Resumen Fisica")).contains("93.41");
        // Plan first: Matemática Aplicada (first word matches, earliest in the
        // plan) over Matemática Discreta, Análisis Matemático and Matemática I.
        assertThat(withPlan.match("Resumen Mate")).contains("82.15");
        assertThat(withPlan.match("Teoría Matemática Discreta full")).contains("93.16");
        assertThat(withPlan.match("Resumen estadistica")).contains("93.24");
        assertThat(withPlan.match("Resumen metodologia")).contains("94.24");
        assertThat(withPlan.match("Resumen Quimica ingreso 2020")).contains("93.04");
        assertThat(withPlan.match("Apuntes comunicacion 5/5/20")).contains("94.21");
        assertThat(withPlan.match("Gestion de Datos")).isEmpty();
    }

    @Test
    void abbreviationsAndPartials() {
        assertThat(withPlan.match("Proba")).contains("93.24");
        assertThat(withPlan.match("Discreta")).contains("93.16");
        assertThat(withPlan.match("Algebra")).contains("93.21");
        assertThat(withPlan.match("Analisis")).contains("93.20");
        assertThat(withPlan.match("Fís 2")).contains("93.42");
        assertThat(withPlan.match("Admin")).contains("81.06");
        assertThat(withPlan.match("EDA final")).contains("72.34");
    }

    @Test
    void withoutThePlanOnlyStrongMatchesCount() {
        // One of two words is below the general threshold.
        assertThat(withoutPlan.match("Resumen metodologia")).isEmpty();
        assertThat(withoutPlan.match("Resumen estadistica")).isEmpty();
        assertThat(withoutPlan.match("Resumen Mate")).contains("93.59");
        assertThat(withoutPlan.match("Teoría Matemática Discreta full")).contains("93.16");
        assertThat(withoutPlan.match("Resumen Quimica ingreso 2020")).contains("93.04");
    }
}
