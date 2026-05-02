package org.ceitba.api.web.classroom;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.classroom.ClassroomService;
import org.ceitba.api.web.classroom.dto.ClassroomDto;
import org.ceitba.api.web.classroom.dto.ClassroomScheduleDto;
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

    public ClassroomController(ClassroomService classroomService) {
        this.classroomService = classroomService;
    }

    @GetMapping
    @Operation(summary = "Get classrooms with filters")
    public Object getClassrooms(
        @RequestParam(required = false) String status,
        @RequestParam(name = "current_semester", required = false, defaultValue = "true") boolean currentSemester
    ) {
        return classroomService.getClassroomsWithFilters(status, currentSemester);
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
