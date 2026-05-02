package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.staff.StaffService;
import org.ceitba.api.web.staff.dto.AssignStaffRequest;
import org.ceitba.api.web.staff.dto.StaffResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Whole controller is path-protected by hasRole("STAFF") in SecurityConfig.
// First staff member must be bootstrapped with SQL — see docs/AUTH-AND-ROLES.md.
@Tag(name = "Staff")
@RestController
@RequestMapping("/v1/staff")
@SecurityRequirement(name = "bearerAuth")
public class StaffController {

    private final StaffService staffService;

    public StaffController(StaffService staffService) {
        this.staffService = staffService;
    }

    @GetMapping
    @Operation(summary = "List currently active staff members")
    public List<StaffResponse> listActive() {
        return staffService.listActive();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Assign STAFF role to a user (creates a CeitbaStaff row)")
    public StaffResponse assign(@Valid @RequestBody AssignStaffRequest req) {
        return staffService.assign(req);
    }

    @DeleteMapping("/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Revoke STAFF (end-dates the membership at now)")
    public void revoke(@PathVariable UUID userId) {
        staffService.revoke(userId);
    }
}
