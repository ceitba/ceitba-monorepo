package org.ceitba.api.service.classroom;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.repository.CommissionTimeRepository;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse.BuildingAvailability;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse.FreeClassroom;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.Normalizer;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

// Free-classroom lookup ("Aulas libres"). Server-side port of what the
// Flutter app computes in lib/features/classrooms/utils/classrooms.dart:
//
//   - The classroom universe is every distinct (building, classroom) with an
//     active commission_time row on ANY day, so a room that only has classes
//     on Tuesday still shows up as free all Monday.
//   - Online / External / "Virtual Asincrónico" rows are not physical rooms
//     and are dropped (both as universe members and as busy slots).
//   - The day is split into 30-minute slots; a slot is busy if any class on
//     that day overlaps it. Class start is rounded down and class end rounded
//     UP to the slot grid (the app floors both, which can report a room free
//     for the last minutes of a class ending at :15/:45; ITBA times are on
//     the half hour in practice, so this only matters for odd data).
//   - Free runs are computed inside the opening window 08:00-23:00 and kept
//     if they last at least `minMinutes` (default 60, the app's "2 slots").
//     A run already in progress at `at` must still have `minMinutes` left
//     from `at` on; otherwise it is dropped (a room free for 10 more minutes
//     is not "free now" for a 60-minute stay).
//
// "Today" and "now" come from the injected ART Clock.
@Service
public class ClassroomAvailabilityService {

    static final LocalTime OPEN_FROM = LocalTime.of(8, 0);
    static final LocalTime OPEN_UNTIL = LocalTime.of(23, 0);
    static final int SLOT_MINUTES = 30;
    static final int DEFAULT_MIN_MINUTES = 60;

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final int OPEN_FROM_SLOT = OPEN_FROM.toSecondOfDay() / 60 / SLOT_MINUTES;
    private static final int OPEN_UNTIL_SLOT = OPEN_UNTIL.toSecondOfDay() / 60 / SLOT_MINUTES;
    private static final int MAX_MIN_MINUTES = (OPEN_UNTIL_SLOT - OPEN_FROM_SLOT) * SLOT_MINUTES;

    private final CommissionTimeRepository commissionTimeRepository;
    private final Clock clock;

    public ClassroomAvailabilityService(CommissionTimeRepository commissionTimeRepository, Clock clock) {
        this.commissionTimeRepository = commissionTimeRepository;
        this.clock = clock;
    }

    // GET /v1/classrooms/availability
    //   day        MONDAY..SUNDAY (case-insensitive); default: today (ART).
    //   building   exact building name (case-insensitive), e.g. SDF/SDR/SDT; default: all.
    //   at         HH:mm; default: now (ART) when the day is today, else 08:00
    //              so every window of another day is listed.
    //   minMinutes minimum free window length; default 60.
    @Transactional(readOnly = true)
    public ClassroomAvailabilityResponse availability(String day, String building,
                                                      String at, Integer minMinutes) {
        LocalDate today = LocalDate.now(clock);
        DayOfWeek todayDow = DayOfWeek.valueOf(today.getDayOfWeek().name());
        DayOfWeek target = day == null || day.isBlank() ? todayDow : parseDay(day);
        LocalTime moment = at == null || at.isBlank()
            ? (target == todayDow ? LocalTime.now(clock).truncatedTo(ChronoUnit.MINUTES) : OPEN_FROM)
            : parseTime(at);
        int min = minMinutes == null ? DEFAULT_MIN_MINUTES : minMinutes;
        if (min < 1 || min > MAX_MIN_MINUTES) {
            throw new ValidationException("minMinutes", min,
                "must be between 1 and " + MAX_MIN_MINUTES);
        }

        // building -> classroom -> busy intervals on the target day. TreeMaps
        // give a stable alphabetical order in the response.
        Map<String, TreeMap<String, List<CommissionTime>>> universe = new TreeMap<>();
        for (var ct : commissionTimeRepository.findActiveOrdered(today)) {
            if (isVirtual(ct.getBuilding()) || isVirtual(ct.getClassroom())) continue;
            if (building != null && !building.isBlank()
                && !ct.getBuilding().equalsIgnoreCase(building.trim())) continue;
            var busy = universe
                .computeIfAbsent(ct.getBuilding(), k -> new TreeMap<>())
                .computeIfAbsent(ct.getClassroom(), k -> new ArrayList<>());
            if (ct.getDay() == target) busy.add(ct);
        }

        int minSlots = (min + SLOT_MINUTES - 1) / SLOT_MINUTES;
        var buildings = new ArrayList<BuildingAvailability>();
        for (var b : universe.entrySet()) {
            var windows = new ArrayList<FreeClassroom>();
            for (var room : b.getValue().entrySet()) {
                for (int[] run : freeRuns(room.getValue(), minSlots)) {
                    LocalTime from = slotTime(run[0]);
                    LocalTime until = slotTime(run[1]);
                    if (!until.isAfter(moment)) continue; // already over
                    boolean freeNow = !from.isAfter(moment);
                    // In progress: only the time left after `at` counts.
                    if (freeNow && ChronoUnit.MINUTES.between(moment, until) < min) continue;
                    windows.add(new FreeClassroom(room.getKey(), from.format(HH_MM),
                        until.format(HH_MM), freeNow));
                }
            }
            windows.sort(Comparator.comparing(FreeClassroom::freeFrom)
                .thenComparing(FreeClassroom::freeUntil)
                .thenComparing(FreeClassroom::classroom));
            int freeNowCount = (int) windows.stream().filter(FreeClassroom::freeNow).count();
            buildings.add(new BuildingAvailability(b.getKey(), b.getValue().size(),
                freeNowCount, windows));
        }

        return new ClassroomAvailabilityResponse(target.name(), moment.format(HH_MM), min,
            OPEN_FROM.format(HH_MM), OPEN_UNTIL.format(HH_MM), buildings);
    }

    // Free runs of at least minSlots slots inside the opening window, as
    // [startSlot, endSlotExclusive] pairs.
    private static List<int[]> freeRuns(List<CommissionTime> busyTimes, int minSlots) {
        boolean[] busy = new boolean[24 * 60 / SLOT_MINUTES];
        for (var ct : busyTimes) {
            int start = minuteOfDay(ct.getHourFrom()) / SLOT_MINUTES;
            // A class ending at midnight may be stored as 00:00: treat any
            // end <= start as running to the end of the day.
            int end = ct.getHourTo().isAfter(ct.getHourFrom())
                ? ceilDiv(minuteOfDay(ct.getHourTo()), SLOT_MINUTES)
                : busy.length;
            for (int i = Math.max(start, 0); i < Math.min(end, busy.length); i++) busy[i] = true;
        }
        var runs = new ArrayList<int[]>();
        int runStart = -1;
        for (int i = OPEN_FROM_SLOT; i <= OPEN_UNTIL_SLOT; i++) {
            boolean free = i < OPEN_UNTIL_SLOT && !busy[i];
            if (free && runStart < 0) {
                runStart = i;
            } else if (!free && runStart >= 0) {
                if (i - runStart >= minSlots) runs.add(new int[]{runStart, i});
                runStart = -1;
            }
        }
        return runs;
    }

    private static int minuteOfDay(LocalTime t) {
        return t.getHour() * 60 + t.getMinute() + (t.getSecond() > 0 ? 1 : 0);
    }

    private static int ceilDiv(int a, int b) {
        return (a + b - 1) / b;
    }

    private static LocalTime slotTime(int slot) {
        return LocalTime.MIN.plusMinutes((long) slot * SLOT_MINUTES);
    }

    // "Online" (normalized from ITBA's "External"), "External" itself, and
    // "Virtual Asincrónico" / any "Virtual ..." classroom are not rooms.
    static boolean isVirtual(String name) {
        if (name == null || name.isBlank()) return true;
        String n = Normalizer.normalize(name.trim(), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT);
        return n.equals("online") || n.equals("external") || n.startsWith("virtual");
    }

    private static DayOfWeek parseDay(String day) {
        try {
            return DayOfWeek.valueOf(day.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ValidationException("day", day,
                "must be one of MONDAY..SUNDAY (case-insensitive)");
        }
    }

    private static LocalTime parseTime(String at) {
        try {
            return LocalTime.parse(at.trim()).truncatedTo(ChronoUnit.MINUTES);
        } catch (DateTimeParseException e) {
            throw new ValidationException("at", at, "must be HH:mm");
        }
    }
}
