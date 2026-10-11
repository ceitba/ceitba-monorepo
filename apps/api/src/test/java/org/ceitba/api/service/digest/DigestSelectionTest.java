package org.ceitba.api.service.digest;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DigestSelectionTest {

    static final DigestContent.Org CEITBA = new DigestContent.Org("ceitba", "CEITBA");
    static final DigestContent.Org SABF = new DigestContent.Org("sabf", "SABF");
    static final DigestWeek WEEK = new DigestWeek(LocalDate.of(2026, 9, 28));

    static DigestContent.Article article(String id, DigestContent.Org org) {
        return new DigestContent.Article(id, "T " + id, "E", null, LocalDate.of(2026, 9, 30), org);
    }

    static DigestContent.Event event(String id, DigestContent.Org org) {
        return new DigestContent.Event(id, "Ev " + id, LocalDate.of(2026, 10, 6),
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 101", org, false);
    }

    static final DigestContent.Candidates CANDIDATES = new DigestContent.Candidates(WEEK,
        List.of(article("a-ceitba", CEITBA), article("a-sabf", SABF), article("a-indep", null)),
        List.of(event("e-ceitba", CEITBA), event("e-sabf", SABF), event("e-none", null)));

    @Test
    void everyOrgAndOrgLessItemIsIncludedByDefault() {
        var s = DigestSelection.included(CANDIDATES, List.of(), List.of());
        assertThat(s.articles()).extracting(DigestContent.Article::id).containsExactly("a-ceitba", "a-sabf", "a-indep");
        assertThat(s.events()).extracting(DigestContent.Event::id).containsExactly("e-ceitba", "e-sabf", "e-none");
    }

    @Test
    void staffExclusionsApply() {
        var s = DigestSelection.included(CANDIDATES, List.of("a-indep", "a-sabf"), List.of("e-ceitba"));
        assertThat(s.articles()).extracting(DigestContent.Article::id).containsExactly("a-ceitba");
        assertThat(s.events()).extracting(DigestContent.Event::id).containsExactly("e-sabf", "e-none");
        assertThat(s.isEmpty()).isFalse();
    }

    @Test
    void everythingExcludedIsEmpty() {
        var s = DigestSelection.included(CANDIDATES, List.of("a-ceitba", "a-sabf", "a-indep"),
            List.of("e-ceitba", "e-sabf", "e-none"));
        assertThat(s.isEmpty()).isTrue();
    }
}
