package org.ceitba.api.web.kb.admin;

import org.ceitba.api.common.exception.ValidationException;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class KbDateParamTest {

    @Test
    void dateOnlyIsTheWholeDayInBuenosAires() {
        assertThat(KbDateParam.from("2026-07-11")).isEqualTo(OffsetDateTime.parse("2026-07-11T00:00:00-03:00"));
        assertThat(KbDateParam.to("2026-07-11")).isEqualTo(OffsetDateTime.parse("2026-07-11T23:59:59.999999999-03:00"));
    }

    @Test
    void fullOffsetDatetimeIsKept() {
        assertThat(KbDateParam.from("2026-07-11T10:30:00Z")).isEqualTo(OffsetDateTime.parse("2026-07-11T10:30:00Z"));
        assertThat(KbDateParam.to("2026-07-11T10:30:00.5-03:00"))
            .isEqualTo(OffsetDateTime.parse("2026-07-11T10:30:00.5-03:00"));
    }

    @Test
    void blankIsAbsentAndGarbageIsAValidationError() {
        assertThat(KbDateParam.from(null)).isNull();
        assertThat(KbDateParam.to(" ")).isNull();
        for (var bad : new String[]{"2026-13-01", "11/07/2026", "2026-07-11T10:30", "ayer", "2026-7-1"}) {
            assertThatThrownBy(() -> KbDateParam.from(bad)).as(bad).isInstanceOf(ValidationException.class);
        }
    }
}
