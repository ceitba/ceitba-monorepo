package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.SubjectType;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DigestTermTest {

    // Second semester 2026 running (starts 2026-08-03, ends 2026-12-05).
    static final LocalDate TODAY = LocalDate.of(2026, 10, 5);

    static Commission c(String id, String subject, String name, String start, String end) {
        return new Commission(id, subject, name, LocalDate.parse(start), LocalDate.parse(end), 0, 30, SubjectType.SEMESTRAL);
    }

    static final Commission FIS_1C_A = c("1", "93.41", "A", "2026-03-09", "2026-07-11");
    static final Commission FIS_2C_A = c("2", "93.41", "A", "2026-08-03", "2026-12-05");
    static final Commission FIS_2C_B = c("3", "93.41", "B", "2026-08-03", "2026-12-05");
    static final Commission MAT_2C_A = c("4", "93.58", "A", "2026-08-03", "2026-12-05");
    static final Commission ANNUAL = c("5", "72.45", "A", "2026-03-02", "2026-12-15");
    // Next March's term already synced: not "current" for the digest.
    static final Commission FIS_NEXT_A = c("6", "93.41", "A", "2027-03-08", "2027-07-10");

    static Map<String, List<Commission>> current(Commission... all) {
        return DigestTerm.currentTermBySubject(List.of(all), TODAY);
    }

    @Test
    void currentTermIsTheRunningOneNotPastOrFarFutureTerms() {
        var cur = current(FIS_1C_A, FIS_2C_A, FIS_2C_B, FIS_NEXT_A, MAT_2C_A);
        assertThat(cur.get("93.41")).containsExactly(FIS_2C_A, FIS_2C_B);
        assertThat(cur.get("93.58")).containsExactly(MAT_2C_A);
    }

    @Test
    void aTermStartingWithinTwoWeeksCountsAndBetweenTermsThereIsNone() {
        var aug = c("7", "93.41", "A", "2026-08-03", "2026-12-05");
        assertThat(DigestTerm.currentTermOf(List.of(aug), LocalDate.of(2026, 7, 22))).containsExactly(aug);
        assertThat(DigestTerm.currentTermOf(List.of(aug), LocalDate.of(2026, 7, 15))).isEmpty();
        assertThat(DigestTerm.currentTermOf(List.of(FIS_1C_A, FIS_2C_A), LocalDate.of(2027, 1, 10))).isEmpty();
    }

    @Test
    void scheduleSavedForThisTermIsCurrent() {
        var picks = List.of(new DigestTerm.Pick("93.41", List.of("A")), new DigestTerm.Pick("93.58", List.of("any")));
        var r = DigestTerm.resolve(picks, LocalDate.of(2026, 7, 20), current(FIS_1C_A, FIS_2C_A, FIS_2C_B, MAT_2C_A));
        assertThat(r.current()).isTrue();
        assertThat(r.subjects()).extracting(DigestTerm.CurrentSubject::subjectCode).containsExactly("93.41", "93.58");
        // Exactly one named commission = the user's; "any" = unknown.
        assertThat(r.subjects().get(0).commissionName()).isEqualTo("A");
        assertThat(r.subjects().get(0).commissions()).containsExactly(FIS_2C_A);
        assertThat(r.subjects().get(1).commissionName()).isNull();
    }

    @Test
    void scheduleSavedForThePreviousTermIsStaleEvenWithTheSameCommissionNames() {
        var picks = List.of(new DigestTerm.Pick("93.41", List.of("A")));
        // Saved in February for the first semester; "A" exists again now.
        var r = DigestTerm.resolve(picks, LocalDate.of(2026, 2, 20), current(FIS_1C_A, FIS_2C_A));
        assertThat(r.current()).isFalse();
        assertThat(r.subjects()).isEmpty();
        // Just inside the planning lead (60 days before 2026-08-03).
        assertThat(DigestTerm.resolve(picks, LocalDate.of(2026, 6, 4), current(FIS_2C_A)).current()).isTrue();
        assertThat(DigestTerm.resolve(picks, LocalDate.of(2026, 6, 3), current(FIS_2C_A)).current()).isFalse();
    }

    @Test
    void yearLongSubjectsDoNotMakeAnOldScheduleCurrent() {
        var picks = List.of(new DigestTerm.Pick("72.45", List.of("A")), new DigestTerm.Pick("93.41", List.of("A")));
        var cur = current(ANNUAL, FIS_2C_A);
        assertThat(DigestTerm.resolve(picks, LocalDate.of(2026, 2, 20), cur).current()).isFalse();
        assertThat(DigestTerm.resolve(picks, LocalDate.of(2026, 7, 25), cur).current()).isTrue();
    }

    @Test
    void unknownSubjectsOrCommissionsAreDroppedAndNothingLeftIsStale() {
        var cur = current(FIS_2C_A, MAT_2C_A);
        var r = DigestTerm.resolve(List.of(
            new DigestTerm.Pick("93.41", List.of("Z")),        // not offered this term
            new DigestTerm.Pick("99.99", List.of("A")),        // no current commission
            new DigestTerm.Pick("93.58", List.of("A", "B"))),  // two names: no own commission
            TODAY, cur);
        assertThat(r.current()).isTrue();
        assertThat(r.subjects()).singleElement().satisfies(s -> {
            assertThat(s.subjectCode()).isEqualTo("93.58");
            assertThat(s.commissionName()).isNull();
        });
        assertThat(DigestTerm.resolve(List.of(new DigestTerm.Pick("93.41", List.of("Z"))), TODAY, cur).current()).isFalse();
        assertThat(DigestTerm.resolve(List.of(), TODAY, cur).current()).isFalse();
    }

    @Test
    void parsesTheSchedulerPayloadAndSkipsJunk() {
        Map<String, Object> payload = Map.of("version", 1, "selectedCourses", List.of(
            Map.of("subject_id", "93.41", "selectedCommissions", List.of("A", 3)),
            Map.of("subject_id", ""),
            "junk",
            Map.of("subject_id", "93.58")));
        assertThat(DigestTerm.parsePayload(payload)).containsExactly(
            new DigestTerm.Pick("93.41", List.of("A")),
            new DigestTerm.Pick("93.58", List.of()));
        assertThat(DigestTerm.parsePayload(Map.of())).isEmpty();
        assertThat(DigestTerm.parsePayload(null)).isEmpty();
    }
}
