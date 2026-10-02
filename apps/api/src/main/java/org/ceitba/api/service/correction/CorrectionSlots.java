package org.ceitba.api.service.correction;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.web.correction.dto.ScheduleSlotInput;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// Normalization, validation and comparison of slot sets. Two slot sets are
// "the same" when their normalized (day, from, to) lists are equal; rooms are
// never compared (they are not editable in v1).
public final class CorrectionSlots {

    public static final int MAX_SLOTS = 6;
    public static final LocalTime EARLIEST = LocalTime.of(7, 0);
    public static final LocalTime LATEST = LocalTime.of(23, 30);

    private static final Pattern TIME = Pattern.compile("^\\d{2}:\\d{2}(:\\d{2})?$");
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter HH_MM_SS = DateTimeFormatter.ofPattern("HH:mm:ss");

    private CorrectionSlots() {}

    // Validates the request slots and returns them normalized: "HH:mm" times,
    // sorted by day, start, end. Throws ValidationException (400) on any rule:
    // 1..6 slots, MONDAY..SATURDAY, from < to, within 07:00-23:30 and no two
    // slots overlapping on the same day (back-to-back is fine).
    public static List<CorrectionSlot> normalize(List<ScheduleSlotInput> input) {
        if (input == null || input.isEmpty() || input.size() > MAX_SLOTS) {
            throw new ValidationException("schedule", input == null ? null : input.size(),
                "must contain between 1 and " + MAX_SLOTS + " slots");
        }
        var slots = new ArrayList<CorrectionSlot>(input.size());
        for (int i = 0; i < input.size(); i++) {
            var in = input.get(i);
            String field = "schedule[" + i + "]";
            if (in == null) throw new ValidationException(field, null, "slot is required");
            DayOfWeek day = parseDay(field + ".day", in.day());
            LocalTime from = parseTime(field + ".time_from", in.timeFrom());
            LocalTime to = parseTime(field + ".time_to", in.timeTo());
            if (!from.isBefore(to)) {
                throw new ValidationException(field, in.timeFrom() + "-" + in.timeTo(),
                    "time_from must be before time_to");
            }
            if (from.isBefore(EARLIEST) || to.isAfter(LATEST)) {
                throw new ValidationException(field, in.timeFrom() + "-" + in.timeTo(),
                    "slots must be between 07:00 and 23:30");
            }
            slots.add(new CorrectionSlot(day.name(), from.format(HH_MM), to.format(HH_MM)));
        }
        slots.sort(CorrectionSlot.ORDER);
        for (int i = 1; i < slots.size(); i++) {
            var prev = slots.get(i - 1);
            var cur = slots.get(i);
            if (prev.day().equals(cur.day()) && prev.to().compareTo(cur.from()) > 0) {
                throw new ValidationException("schedule", cur.key(),
                    "overlaps " + prev.key() + " on the same day");
            }
        }
        return List.copyOf(slots);
    }

    // The commission's SGA slots, normalized like a proposal.
    public static List<CorrectionSlot> fromTimes(Collection<CommissionTime> times) {
        return times.stream()
            .map(t -> new CorrectionSlot(t.getDay().name(), t.getHourFrom().format(HH_MM),
                t.getHourTo().format(HH_MM)))
            .sorted(CorrectionSlot.ORDER)
            .toList();
    }

    public static String key(List<CorrectionSlot> normalized) {
        return normalized.stream().map(CorrectionSlot::key).collect(Collectors.joining("|"));
    }

    public static boolean sameSet(List<CorrectionSlot> a, List<CorrectionSlot> b) {
        return key(sorted(a)).equals(key(sorted(b)));
    }

    // SGA slots as served, ordered by day and start.
    public static List<EffectiveSlot> sga(Collection<CommissionTime> times) {
        return times.stream()
            .map(t -> new EffectiveSlot(t.getDay(), t.getHourFrom(), t.getHourTo(),
                t.getClassroom(), t.getBuilding()))
            .sorted(Comparator.comparing((EffectiveSlot s) -> s.day().ordinal())
                .thenComparing(EffectiveSlot::from)
                .thenComparing(EffectiveSlot::to))
            .toList();
    }

    // A correction's slots as served. Rooms are not part of a correction, so
    // slot i borrows the classroom/building of the i-th SGA slot (both lists
    // ordered by day and start); slots beyond the SGA count get "" for both.
    public static List<EffectiveSlot> withRooms(List<CorrectionSlot> proposed, List<EffectiveSlot> sga) {
        var out = new ArrayList<EffectiveSlot>(proposed.size());
        var sorted = sorted(proposed);
        for (int i = 0; i < sorted.size(); i++) {
            var p = sorted.get(i);
            var room = i < sga.size() ? sga.get(i) : null;
            out.add(new EffectiveSlot(p.dayOfWeek(), p.fromTime(), p.toTime(),
                room != null ? room.classroom() : "", room != null ? room.building() : ""));
        }
        return out;
    }

    public static List<OrganizedSubjectsResponse.Schedule> toSchedule(List<EffectiveSlot> slots) {
        return slots.stream()
            .map(s -> new OrganizedSubjectsResponse.Schedule(s.day().name(), s.classroom(), s.building(),
                s.from().format(HH_MM_SS), s.to().format(HH_MM_SS)))
            .toList();
    }

    private static List<CorrectionSlot> sorted(List<CorrectionSlot> slots) {
        return slots.stream().sorted(CorrectionSlot.ORDER).toList();
    }

    private static DayOfWeek parseDay(String field, String raw) {
        if (raw == null) throw new ValidationException(field, null, "is required");
        DayOfWeek day;
        try {
            day = DayOfWeek.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ValidationException(field, raw, "must be MONDAY..SATURDAY");
        }
        if (day == DayOfWeek.SUNDAY) throw new ValidationException(field, raw, "must be MONDAY..SATURDAY");
        return day;
    }

    private static LocalTime parseTime(String field, String raw) {
        if (raw == null || !TIME.matcher(raw.trim()).matches()) {
            throw new ValidationException(field, raw, "must be HH:mm or HH:mm:ss");
        }
        try {
            LocalTime t = LocalTime.parse(raw.trim());
            if (t.getSecond() != 0) throw new ValidationException(field, raw, "must be a whole minute");
            return t;
        } catch (DateTimeParseException e) {
            throw new ValidationException(field, raw, "must be HH:mm or HH:mm:ss");
        }
    }
}
