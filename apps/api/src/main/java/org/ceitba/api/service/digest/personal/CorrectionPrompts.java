package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

// Which schedule corrections a reader is asked about: PENDING ones (an
// APPLIED one already met the rule) on one of the reader's own commissions,
// that the reader did not suggest and has not voted on. Most confirmed
// first (closest to applying), then oldest; at most `cap`.
public final class CorrectionPrompts {

    private CorrectionPrompts() {}

    static final Comparator<ScheduleCorrection> ORDER = Comparator
        .comparing(ScheduleCorrection::getConfirmCount, Comparator.reverseOrder())
        .thenComparing(ScheduleCorrection::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(ScheduleCorrection::getId, Comparator.nullsLast(Comparator.naturalOrder()));

    public static List<ScheduleCorrection> select(UUID readerId, Set<String> readerCommissionIds,
                                                  Collection<ScheduleCorrection> candidates,
                                                  Set<UUID> votedByReader, int cap) {
        if (cap <= 0 || readerCommissionIds.isEmpty()) return List.of();
        return candidates.stream()
            .filter(c -> c.getStatus() == ScheduleCorrectionStatus.PENDING)
            .filter(c -> readerCommissionIds.contains(c.getCommissionId()))
            .filter(c -> !readerId.equals(c.getSuggesterId()))
            .filter(c -> !votedByReader.contains(c.getId()))
            .sorted(ORDER)
            .limit(cap)
            .toList();
    }
}
