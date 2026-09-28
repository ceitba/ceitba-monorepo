package org.ceitba.api.web.classroom;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.classroom.ClassroomAvailabilityService;
import org.ceitba.api.service.classroom.ClassroomService;
import org.ceitba.api.web.classroom.dto.ClassroomAvailabilityResponse;
import org.ceitba.api.web.classroom.dto.ClassroomDto;
import org.ceitba.api.web.classroom.dto.ClassroomScheduleDto;
import org.ceitba.api.web.classroom.dto.ClassroomsResponse;
import org.ceitba.api.web.classroom.dto.ConflictRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Classrooms")
@RestController
@RequestMapping("/v1/classrooms")
public class ClassroomController {

    private final ClassroomService classroomService;
    private final ClassroomAvailabilityService availabilityService;

    public ClassroomController(ClassroomService classroomService,
                               ClassroomAvailabilityService availabilityService) {
        this.classroomService = classroomService;
        this.availabilityService = availabilityService;
    }

    @GetMapping
    @Operation(summary = "Get classrooms with filters")
    public ClassroomsResponse getClassrooms(
        @RequestParam(required = false) String status,
        @RequestParam(name = "current_semester", required = false, defaultValue = "true") boolean currentSemester
    ) {
        return classroomService.getClassroomsWithFilters(status, currentSemester);
    }

    @GetMapping("/availability")
    @Operation(summary = "Free classrooms per building",
        description = "Free windows (>= minMinutes, inside 08:00-23:00 ART) for the given day, "
            + "that have not ended at `at` (a window already in progress needs minMinutes left after `at`), "
            + "plus how many rooms are free at `at`. "
            + "Defaults: day = today, at = now (08:00 for another day), minMinutes = 60.")
    public ClassroomAvailabilityResponse getAvailability(
        @RequestParam(required = false) String day,
        @RequestParam(required = false) String building,
        @RequestParam(required = false) String at,
        @RequestParam(required = false) Integer minMinutes
    ) {
        return availabilityService.availability(day, building, at, minMinutes);
    }

    @GetMapping("/building/{building}")
    @Operation(summary = "Get classrooms by building")
    public List<ClassroomDto> getClassroomsByBuilding(@PathVariable String building) {
        return classroomService.getClassroomsByBuilding(building);
    }

    @GetMapping("/day/{day}")
    @Operation(summary = "Get classrooms by day")
    public List<ClassroomScheduleDto> getClassroomsByDay(@PathVariable String day) {
        return classroomService.getClassroomsByDay(day);
    }

    @PostMapping("/conflicts")
    @Operation(summary = "Check for classroom conflicts")
    public List<ClassroomScheduleDto> checkConflicts(@Valid @RequestBody ConflictRequest req) {
        return classroomService.findConflicts(req.classroom(), req.building(),
            req.day(), req.hourFrom(), req.hourTo());
    }
}
