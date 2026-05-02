package org.ceitba.api.web.plan;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.plan.SubjectPlanService;
import org.ceitba.api.web.plan.dto.SubjectPlanResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
}
