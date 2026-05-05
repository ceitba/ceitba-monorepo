package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.staff.StaffRosterService;
import org.ceitba.api.web.staff.dto.CreateStaffMemberRequest;
import org.ceitba.api.web.staff.dto.StaffDepartmentResponse;
import org.ceitba.api.web.staff.dto.StaffMemberResponse;
import org.ceitba.api.web.staff.dto.UpdateStaffDepartmentRequest;
import org.ceitba.api.web.staff.dto.UpdateStaffMemberRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Year;
import java.util.List;
import java.util.UUID;

// Public roster shown on ceitba.org.ar; reads are unauthenticated, writes
// require ROLE_STAFF. Distinct from /v1/staff which manages the ROLE_STAFF
// grants themselves.
@Tag(name = "Staff Roster")
@RestController
@RequestMapping("/v1")
public class StaffRosterController {

    private final StaffRosterService service;

    public StaffRosterController(StaffRosterService service) {
        this.service = service;
    }

    @GetMapping("/staff-departments")
    public List<StaffDepartmentResponse> listDepartments() {
        return service.listDepartments();
    }

    @PutMapping("/staff-departments/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public StaffDepartmentResponse updateDepartment(
            @PathVariable String slug,
            @Valid @RequestBody UpdateStaffDepartmentRequest req) {
        return service.updateDepartment(slug, req);
    }

    @GetMapping("/staff-members/years")
    public List<Integer> listYears() {
        var years = service.listYears();
        // No members yet? Surface the current year so the SPA tab UI still has
        // something to render instead of an empty year-picker.
        return years.isEmpty() ? List.of(Year.now().getValue()) : years;
    }

    @GetMapping("/staff-members")
    public List<StaffMemberResponse> listMembers(@RequestParam int year) {
        return service.listMembers(year);
    }

    @PostMapping("/staff-members")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    public StaffMemberResponse createMember(@Valid @RequestBody CreateStaffMemberRequest req) {
        return service.createMember(req);
    }

    @PutMapping("/staff-members/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public StaffMemberResponse updateMember(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateStaffMemberRequest req) {
        return service.updateMember(id, req);
    }

    @DeleteMapping("/staff-members/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    public void deleteMember(@PathVariable UUID id) {
        service.deleteMember(id);
    }
}
