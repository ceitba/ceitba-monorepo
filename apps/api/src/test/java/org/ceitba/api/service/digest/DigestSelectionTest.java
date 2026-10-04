package org.ceitba.api.service.digest;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;

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
            LocalTime.of(18, 0), LocalTime.of(20, 0), "Aula 101", org);
    }

    static final DigestContent.Candidates CANDIDATES = new DigestContent.Candidates(WEEK,
        List.of(article("a-ceitba", CEITBA), article("a-sabf", SABF), article("a-indep", null)),
        List.of(event("e-ceitba", CEITBA), event("e-sabf", SABF)));

    @Test
    void followerOfOneOrgGetsItsContentPlusIndependentArticles() {
        var p = DigestSelection.personalise(CANDIDATES, Set.of("ceitba"), List.of(), List.of(), List.of(CEITBA));
        assertThat(p.articles()).extracting(DigestContent.Article::id).containsExactly("a-ceitba", "a-indep");
        assertThat(p.events()).extracting(DigestContent.Event::id).containsExactly("e-ceitba");
    }

    @Test
    void allOrgsModeSeesEverything() {
        var p = DigestSelection.personalise(CANDIDATES, null, List.of(), List.of(), null);
        assertThat(p.articles()).hasSize(3);
        assertThat(p.events()).hasSize(2);
    }

    @Test
    void staffExclusionsApply() {
        var p = DigestSelection.personalise(CANDIDATES, Set.of("ceitba", "sabf"),
            List.of("a-indep", "a-sabf"), List.of("e-ceitba"), List.of());
        assertThat(p.articles()).extracting(DigestContent.Article::id).containsExactly("a-ceitba");
        assertThat(p.events()).extracting(DigestContent.Event::id).containsExactly("e-sabf");
    }

    @Test
    void followerOfUnrelatedOrgOnlyGetsIndependentArticles() {
        var p = DigestSelection.personalise(CANDIDATES, Set.of("other"), List.of(), List.of(), List.of());
        assertThat(p.articles()).extracting(DigestContent.Article::id).containsExactly("a-indep");
        assertThat(p.events()).isEmpty();
        assertThat(p.isEmpty()).isFalse();

        var none = DigestSelection.personalise(CANDIDATES, Set.of("other"), List.of("a-indep"), List.of(), List.of());
        assertThat(none.isEmpty()).isTrue();
    }
}
