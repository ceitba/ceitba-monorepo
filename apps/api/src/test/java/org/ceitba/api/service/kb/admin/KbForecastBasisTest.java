package org.ceitba.api.service.kb.admin;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// Forecast basis selection (ADMIN doc §7).
class KbForecastBasisTest {

    @Test
    void basisFollowsTheNumberOfCompletedRuns() {
        assertThat(KbForecastService.basis(0)).isEqualTo("corpus");
        assertThat(KbForecastService.basis(1)).isEqualTo("blend");
        assertThat(KbForecastService.basis(2)).isEqualTo("blend");
        assertThat(KbForecastService.basis(3)).isEqualTo("history");
        assertThat(KbForecastService.basis(8)).isEqualTo("history");
    }

    @Test
    void blendWeightsHistoryByRunsOverThree() {
        var w = new BigDecimal("0.333333");
        assertThat(KbForecastService.blend(new BigDecimal("3"), new BigDecimal("6"), w).doubleValue())
            .isCloseTo(5.0, org.assertj.core.data.Offset.offset(0.001));
    }

    @Test
    void quantilesAreP25MedianP75() {
        var q = KbForecastService.quantiles(List.of(new BigDecimal("4"), new BigDecimal("1"), new BigDecimal("3"),
            new BigDecimal("2"), new BigDecimal("5")));
        assertThat(q[0]).isEqualByComparingTo("2");
        assertThat(q[1]).isEqualByComparingTo("3");
        assertThat(q[2]).isEqualByComparingTo("4");
        assertThat(KbForecastService.quantiles(List.of())[1]).isEqualByComparingTo("0");
    }
}
