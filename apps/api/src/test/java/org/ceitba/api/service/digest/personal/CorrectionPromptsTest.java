package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CorrectionPromptsTest {

    static final UUID READER = UUID.randomUUID();
    static final UUID OTHER = UUID.randomUUID();
    static final OffsetDateTime T0 = OffsetDateTime.parse("2026-09-01T12:00:00-03:00");

    static ScheduleCorrection correction(String commission, UUID suggester, ScheduleCorrectionStatus status,
                                         int confirms, int minutes) {
        var slot = List.of(new CorrectionSlot("TUESDAY", "09:00", "12:00"));
        var c = new ScheduleCorrection(commission, suggester, slot, List.of(), "TUESDAY 09:00-12:00");
        ReflectionTestUtils.setField(c, "id", UUID.randomUUID());
        ReflectionTestUtils.setField(c, "createdAt", T0.plusMinutes(minutes));
        c.setStatus(status);
        c.setCounts(confirms, 0);
        return c;
    }

    @Test
    void onlyPendingOnOwnCommissionsNotSuggestedOrVotedByTheReader() {
        var ok = correction("c1", OTHER, ScheduleCorrectionStatus.PENDING, 1, 0);
        var anonymousSuggester = correction("c1", null, ScheduleCorrectionStatus.PENDING, 1, 1);
        var own = correction("c1", READER, ScheduleCorrectionStatus.PENDING, 2, 2);
        var voted = correction("c1", OTHER, ScheduleCorrectionStatus.PENDING, 2, 3);
        var applied = correction("c1", OTHER, ScheduleCorrectionStatus.APPLIED, 3, 4);
        var rejected = correction("c1", OTHER, ScheduleCorrectionStatus.REJECTED, 0, 5);
        var otherCommission = correction("c2", OTHER, ScheduleCorrectionStatus.PENDING, 2, 6);

        var picked = CorrectionPrompts.select(READER, Set.of("c1"),
            List.of(ok, anonymousSuggester, own, voted, applied, rejected, otherCommission),
            Set.of(voted.getId()), 3);
        assertThat(picked).containsExactly(ok, anonymousSuggester);
    }

    @Test
    void mostConfirmedFirstThenOldestAndCapped() {
        var a = correction("c1", OTHER, ScheduleCorrectionStatus.PENDING, 1, 0);
        var b = correction("c1", OTHER, ScheduleCorrectionStatus.PENDING, 2, 5);
        var c = correction("c2", OTHER, ScheduleCorrectionStatus.PENDING, 2, 1);
        var d = correction("c2", OTHER, ScheduleCorrectionStatus.PENDING, 0, 2);
        assertThat(CorrectionPrompts.select(READER, Set.of("c1", "c2"), List.of(a, b, c, d), Set.of(), 3))
            .containsExactly(c, b, a);
        assertThat(CorrectionPrompts.select(READER, Set.of("c1", "c2"), List.of(a, b), Set.of(), 0)).isEmpty();
        assertThat(CorrectionPrompts.select(READER, Set.of(), List.of(a, b), Set.of(), 3)).isEmpty();
    }
}
