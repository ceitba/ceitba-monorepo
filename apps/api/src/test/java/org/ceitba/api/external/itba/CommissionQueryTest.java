package org.ceitba.api.external.itba;

import org.ceitba.api.config.ClockConfig;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class CommissionQueryTest {

    @Test
    void defaults_useArgentinaDate_notUtc() {
        // 2026-01-01T01:00Z is still 2025-12-31 22:00 in Buenos Aires (UTC-3):
        // the default year must be 2025, not 2026.
        var clock = Clock.fixed(Instant.parse("2026-01-01T01:00:00Z"), ClockConfig.ZONE);

        var q = CommissionQuery.defaults().withDefaultsFilled(clock);

        assertThat(q.year()).isEqualTo(2025);
        assertThat(q.period()).isEqualTo("SecondSemester");
        assertThat(q.levels()).containsExactlyElementsOf(CommissionQuery.DEFAULT_LEVELS);
    }

    @Test
    void defaults_firstSemester_betweenFebruaryAndJune() {
        var clock = Clock.fixed(Instant.parse("2026-03-15T12:00:00Z"), ClockConfig.ZONE);

        var q = CommissionQuery.defaults().withDefaultsFilled(clock);

        assertThat(q.year()).isEqualTo(2026);
        assertThat(q.period()).isEqualTo("FirstSemester");
    }

    @Test
    void explicitValues_areKept() {
        var clock = Clock.fixed(Instant.parse("2026-03-15T12:00:00Z"), ClockConfig.ZONE);

        var q = new CommissionQuery(2024, "SecondSemester", java.util.List.of("GRADUATE"))
            .withDefaultsFilled(clock);

        assertThat(q.year()).isEqualTo(2024);
        assertThat(q.period()).isEqualTo("SecondSemester");
        assertThat(q.levels()).containsExactly("GRADUATE");
    }
}
