package org.ceitba.api.web.plan;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.plan.SubjectPlanService;
import org.ceitba.api.web.plan.dto.CreateSubjectPlanRequest;
import org.ceitba.api.web.plan.dto.SubjectPlanResponse;
import org.ceitba.api.web.plan.dto.UpdateSubjectPlanRequest;
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

import java.util.List;

@Tag(name = "Subject by plan")
@RestController
@RequestMapping("/v1/plans")
public class SubjectPlanController {

    private final SubjectPlanService subjectPlanService;

    public SubjectPlanController(SubjectPlanService subjectPlanService) {
        this.subjectPlanService = subjectPlanService;
    }

    @GetMapping("/{planId}/subjects")
    @Operation(summary = "Get subjects by plan with filters (DB-backed)")
    public List<SubjectPlanResponse> getSubjectsByPlan(
        @PathVariable String planId,
        @Parameter @RequestParam(required = false) Integer year,
        @Parameter @RequestParam(required = false) Integer semester,
        @Parameter @RequestParam(required = false) String section,
        @Parameter @RequestParam(required = false) String type
    ) {
        return subjectPlanService.getSubjectsByPlan(planId,
            new SubjectPlanService.PlanFilters(year, semester, section, type));
    }

    @GetMapping("/subjects/{subjectId}/plans")
    @Operation(summary = "List every plan that contains a given subject")
    public List<SubjectPlanResponse> getPlansForSubject(@PathVariable String subjectId) {
        return subjectPlanService.getPlansForSubject(subjectId);
    }

    @GetMapping("/{planId}/subject/{subjectId}")
    @Operation(summary = "Get one specific subject-within-plan")
    public SubjectPlanResponse getOne(@PathVariable String planId, @PathVariable String subjectId) {
        return subjectPlanService.getOne(planId, subjectId);
    }

    // Writes: STAFF only. plan_subject is a sync-target, edit-by-hand is an
    // escape hatch.
    @PostMapping("/{planId}/subject")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Create a subject-within-plan (STAFF only)")
    public SubjectPlanResponse create(@PathVariable String planId,
                                      @Valid @RequestBody CreateSubjectPlanRequest req) {
        return subjectPlanService.create(planId, req);
    }

    @PutMapping("/{planId}/subject/{subjectId}")
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Update a subject-within-plan (STAFF only)")
    public SubjectPlanResponse update(@PathVariable String planId,
                                      @PathVariable String subjectId,
                                      @Valid @RequestBody UpdateSubjectPlanRequest req) {
        return subjectPlanService.update(planId, subjectId, req);
    }

    @DeleteMapping("/{planId}/subject/{subjectId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Delete a subject-within-plan (STAFF only)")
    public void delete(@PathVariable String planId, @PathVariable String subjectId) {
        subjectPlanService.delete(planId, subjectId);
    }
}
