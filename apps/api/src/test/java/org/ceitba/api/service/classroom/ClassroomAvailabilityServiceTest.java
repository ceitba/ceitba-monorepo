package org.ceitba.api.service.classroom;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.repository.CommissionTimeRepository;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse.BuildingAvailability;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse.FreeClassroom;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClassroomAvailabilityServiceTest {

    private static final ZoneId ART = ZoneId.of("America/Argentina/Buenos_Aires");
    // Monday 2026-09-21 10:30 ART (13:30Z).
    private static final Instant MONDAY_1030 = Instant.parse("2026-09-21T13:30:00Z");

    private final CommissionTimeRepository repo = mock(CommissionTimeRepository.class);
    private final List<CommissionTime> rows = new ArrayList<>();

    private ClassroomAvailabilityService service(Instant now) {
        when(repo.findActiveOrdered(any())).thenReturn(rows);
        return new ClassroomAvailabilityService(repo, Clock.fixed(now, ART));
    }

    private void busy(String building, String room, DayOfWeek day, String from, String to) {
        rows.add(new CommissionTime("C-" + rows.size(), day, LocalTime.parse(from),
            room, building, LocalTime.parse(to)));
    }

    private static BuildingAvailability building(ClassroomAvailabilityResponse r, String name) {
        return r.buildings().stream().filter(b -> b.building().equals(name)).findFirst().orElseThrow();
    }

    private static List<String> windows(BuildingAvailability b, String room) {
        return b.classrooms().stream()
            .filter(c -> c.classroom().equals(room))
            .map(c -> c.freeFrom() + "-" + c.freeUntil() + (c.freeNow() ? "*" : ""))
            .toList();
    }

    @Test
    void defaultsToTodayAndNowInArt() {
        // 02:00Z Tuesday is still Monday 23:00 in ART.
        var r = service(Instant.parse("2026-09-22T02:00:00Z")).availability(null, null, null, null);
        assertThat(r.day()).isEqualTo("MONDAY");
        assertThat(r.at()).isEqualTo("23:00");
        assertThat(r.minMinutes()).isEqualTo(60);
        assertThat(r.openFrom()).isEqualTo("08:00");
        assertThat(r.openUntil()).isEqualTo("23:00");
        verify(repo).findActiveOrdered(LocalDate.of(2026, 9, 21));
    }

    @Test
    void freeWindowsBetweenClassesWithTouchingBoundaries() {
        busy("SDF", "101", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDF", "101", DayOfWeek.MONDAY, "12:00", "14:00");
        busy("SDF", "101", DayOfWeek.MONDAY, "18:00", "23:00");
        var svc = service(MONDAY_1030);

        var early = building(svc.availability("MONDAY", null, "07:00", null), "SDF");
        assertThat(windows(early, "101")).containsExactly("10:00-12:00", "14:00-18:00");
        assertThat(early.freeNowCount()).isZero();

        // A window starting exactly at `at` is free now.
        var atTen = building(svc.availability("MONDAY", null, "10:00", null), "SDF");
        assertThat(windows(atTen, "101")).containsExactly("10:00-12:00*", "14:00-18:00");
        assertThat(atTen.freeNowCount()).isEqualTo(1);

        // A window ending exactly at `at` is over.
        var atNoon = building(svc.availability("MONDAY", null, "12:00", null), "SDF");
        assertThat(windows(atNoon, "101")).containsExactly("14:00-18:00");
        assertThat(atNoon.freeNowCount()).isZero();

        // Default `at` is the clock's 10:30.
        var now = building(svc.availability(null, null, null, null), "SDF");
        assertThat(windows(now, "101")).containsExactly("10:00-12:00*", "14:00-18:00");
    }

    @Test
    void windowInProgressNeedsMinMinutesLeftAfterAt() {
        busy("SDF", "101", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDF", "101", DayOfWeek.MONDAY, "12:00", "14:00");
        busy("SDF", "101", DayOfWeek.MONDAY, "15:00", "23:00");
        var svc = service(MONDAY_1030);

        // Exactly 60 minutes left: still free now.
        var at11 = building(svc.availability("MONDAY", null, "11:00", null), "SDF");
        assertThat(windows(at11, "101")).containsExactly("10:00-12:00*", "14:00-15:00");
        assertThat(at11.freeNowCount()).isEqualTo(1);

        // Only 30 (or 1) minutes left: not a usable 60-minute window any more.
        var at1130 = building(svc.availability("MONDAY", null, "11:30", null), "SDF");
        assertThat(windows(at1130, "101")).containsExactly("14:00-15:00");
        assertThat(at1130.freeNowCount()).isZero();
        assertThat(windows(building(svc.availability("MONDAY", null, "11:59", null), "SDF"), "101"))
            .containsExactly("14:00-15:00");

        // A shorter minMinutes accepts the remaining 30 minutes.
        var short30 = building(svc.availability("MONDAY", null, "11:30", 30), "SDF");
        assertThat(windows(short30, "101")).containsExactly("10:00-12:00*", "14:00-15:00");
    }

    @Test
    void windowsAreClampedToOpeningHours() {
        busy("SDT", "A", DayOfWeek.MONDAY, "10:00", "11:00");
        busy("SDT", "B", DayOfWeek.MONDAY, "07:00", "08:30");
        busy("SDT", "B", DayOfWeek.MONDAY, "22:30", "23:59");
        var b = building(service(MONDAY_1030).availability("MONDAY", null, "07:00", null), "SDT");

        assertThat(windows(b, "A")).containsExactly("08:00-10:00", "11:00-23:00");
        assertThat(windows(b, "B")).containsExactly("08:30-22:30");
    }

    @Test
    void shortGapsNeedMinMinutesAndOddTimesRoundOutward() {
        busy("SDR", "5", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDR", "5", DayOfWeek.MONDAY, "10:30", "12:15");  // busy until 12:30
        busy("SDR", "5", DayOfWeek.MONDAY, "13:45", "23:00");  // busy from 13:30
        var svc = service(MONDAY_1030);

        assertThat(windows(building(svc.availability("MONDAY", null, "08:00", null), "SDR"), "5"))
            .containsExactly("12:30-13:30");
        assertThat(windows(building(svc.availability("MONDAY", null, "08:00", 30), "SDR"), "5"))
            .containsExactly("10:00-10:30", "12:30-13:30");
        assertThat(windows(building(svc.availability("MONDAY", null, "08:00", 90), "SDR"), "5"))
            .isEmpty();
    }

    @Test
    void onlineExternalAndVirtualRowsAreExcluded() {
        busy("Online", "Virtual Asincrónico", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("External", "Zoom", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDF", "Virtual Asincronico", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDF", "VIRTUAL SINCRÓNICO", DayOfWeek.TUESDAY, "08:00", "10:00");
        busy("SDF", "201", DayOfWeek.MONDAY, "08:00", "10:00");
        var r = service(MONDAY_1030).availability("MONDAY", null, "08:00", null);

        assertThat(r.buildings()).extracting(BuildingAvailability::building).containsExactly("SDF");
        var sdf = building(r, "SDF");
        assertThat(sdf.totalClassrooms()).isEqualTo(1);
        assertThat(sdf.classrooms()).extracting(FreeClassroom::classroom).containsOnly("201");
    }

    @Test
    void classroomBusyOnlyOnAnotherDayIsFreeAllDay() {
        busy("SDF", "301", DayOfWeek.TUESDAY, "09:00", "12:00");
        busy("SDF", "302", DayOfWeek.MONDAY, "08:00", "23:00");
        var sdf = building(service(MONDAY_1030).availability("MONDAY", null, "10:30", null), "SDF");

        assertThat(sdf.totalClassrooms()).isEqualTo(2);
        assertThat(windows(sdf, "301")).containsExactly("08:00-23:00*");
        assertThat(windows(sdf, "302")).isEmpty();
        assertThat(sdf.freeNowCount()).isEqualTo(1);
    }

    @Test
    void anotherDayDefaultsAtToOpeningTime() {
        busy("SDF", "301", DayOfWeek.TUESDAY, "09:00", "12:00");
        var r = service(MONDAY_1030).availability("tuesday", null, null, null);

        assertThat(r.day()).isEqualTo("TUESDAY");
        assertThat(r.at()).isEqualTo("08:00");
        assertThat(windows(building(r, "SDF"), "301")).containsExactly("08:00-09:00*", "12:00-23:00");
    }

    @Test
    void sundayWithNoClassesListsEveryRoomFree() {
        busy("SDF", "101", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDT", "7", DayOfWeek.FRIDAY, "08:00", "10:00");
        // Sunday 2026-09-27 15:00 ART.
        var r = service(Instant.parse("2026-09-27T18:00:00Z")).availability(null, null, null, null);

        assertThat(r.day()).isEqualTo("SUNDAY");
        assertThat(r.buildings()).extracting(BuildingAvailability::building).containsExactly("SDF", "SDT");
        assertThat(r.buildings()).allSatisfy(b -> assertThat(b.freeNowCount()).isEqualTo(1));
        assertThat(windows(building(r, "SDT"), "7")).containsExactly("08:00-23:00*");
    }

    @Test
    void emptyScheduleReturnsNoBuildings() {
        var r = service(MONDAY_1030).availability(null, null, null, null);
        assertThat(r.buildings()).isEmpty();
    }

    @Test
    void afterClosingNothingIsListed() {
        busy("SDF", "101", DayOfWeek.MONDAY, "08:00", "10:00");
        var sdf = building(service(MONDAY_1030).availability("MONDAY", null, "23:30", null), "SDF");
        assertThat(sdf.classrooms()).isEmpty();
        assertThat(sdf.totalClassrooms()).isEqualTo(1);
    }

    @Test
    void buildingFilterIsCaseInsensitive() {
        busy("SDF", "101", DayOfWeek.MONDAY, "08:00", "10:00");
        busy("SDT", "7", DayOfWeek.MONDAY, "08:00", "10:00");
        var r = service(MONDAY_1030).availability("MONDAY", "sdt", null, null);
        assertThat(r.buildings()).extracting(BuildingAvailability::building).containsExactly("SDT");
    }

    @Test
    void invalidParametersAreRejected() {
        var svc = service(MONDAY_1030);
        assertThatThrownBy(() -> svc.availability("funday", null, null, null))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.availability(null, null, "25:99", null))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.availability(null, null, null, 0))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.availability(null, null, null, 901))
            .isInstanceOf(ValidationException.class);
    }
}
