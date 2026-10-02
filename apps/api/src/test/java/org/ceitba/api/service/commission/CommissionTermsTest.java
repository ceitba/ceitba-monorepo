package org.ceitba.api.service.commission;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.SubjectType;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CommissionTermsTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 2);

    private static Commission c(String id, String subject, LocalDate start, LocalDate end) {
        return new Commission(id, subject, "A", start, end, 0, 0, SubjectType.SEMESTRAL);
    }

    private static List<String> ids(List<Commission> list) {
        return list.stream().map(Commission::getId).toList();
    }

    @Test
    void emptyStaysEmpty() {
        assertThat(CommissionTerms.currentTerm(List.of(), TODAY)).isEmpty();
    }

    @Test
    void endedTermsAreDroppedWhileTheRunningTermHasCommissions() {
        var list = List.of(
            c("s1-g", "31.08", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 25)),
            c("s2-g", "31.08", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 31)),
            c("s2-b", "31.08", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 31)));
        assertThat(ids(CommissionTerms.currentTerm(list, TODAY))).containsExactly("s2-g", "s2-b");
    }

    // The next term is synced before the current one ends: both are "not
    // ended", only the upcoming one is shown.
    @Test
    void nextTermSyncedEarlyReplacesTheRunningTerm() {
        var list = List.of(
            c("now-g", "31.08", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15)),
            c("now-b", "31.08", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15)),
            c("next-g", "31.08", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 7, 10)),
            c("next-b", "31.08", LocalDate.of(2027, 3, 9), LocalDate.of(2027, 7, 10)));
        assertThat(ids(CommissionTerms.currentTerm(list, LocalDate.of(2026, 12, 1))))
            .containsExactly("next-g", "next-b");
    }

    // 81.74: two bimester modules of the same term, starts 42 days apart.
    @Test
    void concurrentOfferingsOfTheSameTermAreBothKept() {
        var list = List.of(
            c("46512", "81.74", LocalDate.of(2026, 9, 14), LocalDate.of(2026, 10, 23)),
            c("47536", "81.74", LocalDate.of(2026, 10, 26), LocalDate.of(2026, 11, 30)));
        assertThat(ids(CommissionTerms.currentTerm(list, TODAY))).containsExactly("46512", "47536");
    }

    // A late module of the running term plus the next term synced early: only
    // the next term (the module starts > 60 days before it).
    @Test
    void lateModuleOfTheRunningTermIsNotMistakenForTheNextTerm() {
        var list = List.of(
            c("mod2", "81.74", LocalDate.of(2026, 10, 26), LocalDate.of(2026, 11, 30)),
            c("next", "81.74", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 5, 1)));
        assertThat(ids(CommissionTerms.currentTerm(list, LocalDate.of(2026, 11, 10))))
            .containsExactly("next");
    }

    @Test
    void windowBoundaryIsInclusive() {
        var newest = LocalDate.of(2027, 3, 8);
        var list = List.of(
            c("edge", "x", newest.minusDays(CommissionTerms.TERM_WINDOW_DAYS), LocalDate.of(2027, 7, 1)),
            c("out", "x", newest.minusDays(CommissionTerms.TERM_WINDOW_DAYS + 1), LocalDate.of(2027, 7, 1)),
            c("newest", "x", newest, LocalDate.of(2027, 7, 1)));
        assertThat(ids(CommissionTerms.currentTerm(list, TODAY))).containsExactly("edge", "newest");
    }

    @Test
    void endsTodayIsNotEnded() {
        var list = List.of(
            c("today", "x", LocalDate.of(2026, 3, 1), TODAY),
            c("past", "x", LocalDate.of(2025, 8, 1), LocalDate.of(2025, 12, 1)));
        assertThat(ids(CommissionTerms.currentTerm(list, TODAY))).containsExactly("today");
    }

    // Nothing running: the most recent term, including all of its parallel
    // offerings, instead of an empty subject.
    @Test
    void fallsBackToTheMostRecentTermWhenEverythingEnded() {
        var list = List.of(
            c("2025", "72.99", LocalDate.of(2025, 3, 1), LocalDate.of(2025, 7, 25)),
            c("mod1", "72.99", LocalDate.of(2026, 3, 2), LocalDate.of(2026, 5, 1)),
            c("mod2", "72.99", LocalDate.of(2026, 4, 27), LocalDate.of(2026, 7, 1)));
        assertThat(ids(CommissionTerms.currentTerm(list, TODAY))).containsExactly("mod1", "mod2");
    }

    @Test
    void bySubjectSelectsPerSubjectAndKeepsOrder() {
        var list = List.of(
            c("a-old", "A", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 25)),
            c("a-now", "A", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15)),
            c("b-now", "B", LocalDate.of(2026, 7, 26), LocalDate.of(2026, 12, 15)),
            c("b-next", "B", LocalDate.of(2027, 3, 8), LocalDate.of(2027, 7, 10)));
        var bySubject = CommissionTerms.currentTermBySubject(list, TODAY);
        assertThat(bySubject.keySet()).containsExactly("A", "B");
        assertThat(ids(bySubject.get("A"))).containsExactly("a-now");
        assertThat(ids(bySubject.get("B"))).containsExactly("b-next");
    }
}
