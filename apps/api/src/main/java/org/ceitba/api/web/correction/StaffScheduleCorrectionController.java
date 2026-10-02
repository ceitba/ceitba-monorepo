package org.ceitba.api.web.correction;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.correction.dto.StaffCorrectionResponse;
import org.ceitba.api.web.news.dto.PageResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

// STAFF override of schedule corrections (also gated by the /v1/staff/**
// rule in SecurityConfig). Still anonymous: staff never see the suggester.
// "Revert" an applied correction = reject it.
@Tag(name = "Schedule corrections (staff)")
@RestController
@RequestMapping("/v1/staff/schedule-corrections")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffScheduleCorrectionController {

    private final ScheduleCorrectionService service;

    public StaffScheduleCorrectionController(ScheduleCorrectionService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Schedule corrections, newest first, optionally filtered by status",
        description = "Corrections of commissions whose course has ended are left out of the default list "
            + "and of the PENDING and APPLIED filters; REJECTED, RESOLVED and SUPERSEDED still list them.")
    public PageResponse<StaffCorrectionResponse> list(@RequestParam(required = false) ScheduleCorrectionStatus status,
                                                      @RequestParam(defaultValue = "1") int page,
                                                      @RequestParam(defaultValue = "20") int limit) {
        return service.staffList(status, page, limit);
    }

    @PostMapping("/{id}/apply")
    @Operation(summary = "Apply a pending/applied correction (supersedes the current applied one)")
    public StaffCorrectionResponse apply(@CurrentUser User staff, @PathVariable UUID id) {
        return service.staffApply(id, staff.getId());
    }

    @PostMapping("/{id}/reject")
    @Operation(summary = "Reject a pending correction or revert an applied one")
    public StaffCorrectionResponse reject(@CurrentUser User staff, @PathVariable UUID id) {
        return service.staffReject(id, staff.getId());
    }
}
