package org.ceitba.api.service.digest;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DigestWeekTest {

    @Test
    void rejectsNonMonday() {
        assertThatThrownBy(() -> new DigestWeek(LocalDate.of(2026, 10, 6)))
            .isInstanceOf(DigestException.class)
            .extracting(e -> ((DigestException) e).reason())
            .isEqualTo(DigestException.Reason.INVALID_WEEK_START);
    }

    @Test
    void coveredWeekAndFollowingWeek() {
        var w = new DigestWeek(LocalDate.of(2026, 9, 28));
        assertThat(w.weekEnd()).isEqualTo(LocalDate.of(2026, 10, 4));
        assertThat(w.eventsFrom()).isEqualTo(LocalDate.of(2026, 10, 5));
        assertThat(w.eventsTo()).isEqualTo(LocalDate.of(2026, 10, 11));
    }

    @Test
    void previousWeekFromAnyDay() {
        assertThat(DigestWeek.previousWeek(LocalDate.of(2026, 10, 5)).weekStart()).isEqualTo(LocalDate.of(2026, 9, 28));
        assertThat(DigestWeek.previousWeek(LocalDate.of(2026, 10, 11)).weekStart()).isEqualTo(LocalDate.of(2026, 9, 28));
    }

    @Test
    void spanishSubject() {
        assertThat(new DigestWeek(LocalDate.of(2026, 10, 5)).defaultSubject())
            .isEqualTo("La semana en ITBA · 5 al 11 de octubre");
        assertThat(new DigestWeek(LocalDate.of(2026, 9, 28)).defaultSubject())
            .isEqualTo("La semana en ITBA · 28 de septiembre al 4 de octubre");
    }
}
