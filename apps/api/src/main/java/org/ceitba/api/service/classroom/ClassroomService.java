package org.ceitba.api.service.classroom;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.DayOfWeek;
import org.ceitba.api.repository.CommissionTimeRepository;
import org.ceitba.api.web.classroom.dto.ClassroomDto;
import org.ceitba.api.web.classroom.dto.ClassroomScheduleDto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ClassroomService {

    private static final String ONLINE = "Online";

    private final CommissionTimeRepository commissionTimeRepository;
    private final Clock clock;

    public ClassroomService(CommissionTimeRepository commissionTimeRepository, Clock clock) {
        this.commissionTimeRepository = commissionTimeRepository;
        this.clock = clock;
    }

    // GET /v1/classrooms
    // status=occupied -> nested {day: {building: [scheduleDto]}}
    // else            -> {building: [classroomDto]}
    @Transactional(readOnly = true)
    public Object getClassroomsWithFilters(String status, boolean currentSemester) {
        if ("occupied".equals(status)) {
            var rows = currentSemester
                ? commissionTimeRepository.findActiveOrdered(LocalDate.now(clock))
                : commissionTimeRepository.findAllOrdered();
            return groupByDayAndBuilding(rows);
        }
        return groupByBuilding(commissionTimeRepository.findAllOrdered());
    }

    // GET /v1/classrooms/building/{building}
    @Transactional(readOnly = true)
    public List<ClassroomDto> getClassroomsByBuilding(String building) {
        return commissionTimeRepository.findAllOrdered().stream()
            .filter(ct -> ct.getBuilding().equalsIgnoreCase(building))
            .map(this::toClassroomDto)
            .toList();
    }

    // GET /v1/classrooms/day/{day}
    @Transactional(readOnly = true)
    public List<ClassroomScheduleDto> getClassroomsByDay(String day) {
        DayOfWeek target;
        try {
            target = DayOfWeek.valueOf(day.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ValidationException("day", day,
                "must be one of MONDAY..SUNDAY (case-insensitive)");
        }
        return commissionTimeRepository.findActiveOrdered(LocalDate.now(clock)).stream()
            .filter(ct -> ct.getDay() == target)
            .map(this::toScheduleDto)
            .toList();
    }

    // POST /v1/classrooms/conflicts
    @Transactional(readOnly = true)
    public List<ClassroomScheduleDto> findConflicts(String classroom, String building,
                                                    String day, String hourFrom, String hourTo) {
        DayOfWeek target;
        try {
            target = DayOfWeek.valueOf(day.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ValidationException("day", day, "must be a valid day-of-week name");
        }
        LocalTime from, to;
        try {
            from = LocalTime.parse(normalizeTime(hourFrom));
            to = LocalTime.parse(normalizeTime(hourTo));
        } catch (DateTimeParseException e) {
            throw new ValidationException("hourFrom/hourTo", hourFrom + "/" + hourTo,
                "must be HH:mm or HH:mm:ss");
        }
        if (!from.isBefore(to)) {
            throw new ValidationException("hourFrom", hourFrom, "must be before hourTo");
        }

        return commissionTimeRepository.findActiveOrdered(LocalDate.now(clock)).stream()
            .filter(ct -> ct.getDay() == target)
            .filter(ct -> ct.getClassroom().equalsIgnoreCase(classroom)
                       && ct.getBuilding().equalsIgnoreCase(building))
            .filter(ct -> TimeOverlap.overlaps(ct.getHourFrom(), ct.getHourTo(), from, to))
            .map(this::toScheduleDto)
            .toList();
    }

    // ----- mappers -----
    private static String normalizeTime(String s) {
        return s.length() == 5 ? s + ":00" : s;
    }

    private ClassroomDto toClassroomDto(CommissionTime ct) {
        return new ClassroomDto(
            ct.getClassroom(), ct.getBuilding(),
            ct.getDay() != null ? ct.getDay().name() : null,
            ct.getHourFrom() != null ? ct.getHourFrom().toString() : null,
            ct.getHourTo() != null ? ct.getHourTo().toString() : null
        );
    }

    private ClassroomScheduleDto toScheduleDto(CommissionTime ct) {
        return new ClassroomScheduleDto(
            ct.getClassroom(), ct.getBuilding(),
            ct.getDay() != null ? ct.getDay().name() : null,
            ct.getHourFrom() != null ? ct.getHourFrom().toString() : null,
            ct.getHourTo() != null ? ct.getHourTo().toString() : null
        );
    }

    private Map<String, List<ClassroomDto>> groupByBuilding(List<CommissionTime> rows) {
        var out = new LinkedHashMap<String, List<ClassroomDto>>();
        for (var ct : rows) {
            if (ONLINE.equalsIgnoreCase(ct.getBuilding())) continue; // skip online
            out.computeIfAbsent(ct.getBuilding(), k -> new java.util.ArrayList<>())
                .add(toClassroomDto(ct));
        }
        return out;
    }

    private Map<String, Map<String, List<ClassroomScheduleDto>>>
            groupByDayAndBuilding(List<CommissionTime> rows) {
        var out = new LinkedHashMap<String, Map<String, List<ClassroomScheduleDto>>>();
        for (var ct : rows) {
            if (ct.getDay() == null) continue;
            if (ONLINE.equalsIgnoreCase(ct.getBuilding())) continue;
            out.computeIfAbsent(ct.getDay().name(), k -> new LinkedHashMap<>())
                .computeIfAbsent(ct.getBuilding(), k -> new java.util.ArrayList<>())
                .add(toScheduleDto(ct));
        }
        return out;
    }
}
