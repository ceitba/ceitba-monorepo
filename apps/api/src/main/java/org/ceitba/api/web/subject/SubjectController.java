package org.ceitba.api.web.subject;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.plan.SubjectPlanService;
import org.ceitba.api.service.subject.SubjectService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;
import org.ceitba.api.web.subject.dto.SubjectResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@Tag(name = "Subjects")
@RestController
@RequestMapping("/v1/subjects")
public class SubjectController {

    private final SubjectService subjectService;
    private final SubjectPlanService subjectPlanService;

    public SubjectController(SubjectService subjectService, SubjectPlanService subjectPlanService) {
        this.subjectService = subjectService;
        this.subjectPlanService = subjectPlanService;
    }

    // Public. With a valid session/Bearer, each schedule correction's
    // my_vote carries the caller's vote; anonymous callers get null.
    @GetMapping
    @Operation(summary = "Get subjects organized by plan (section/year/semester)",
        description = "Commission `schedule` is the effective schedule (an applied student correction "
            + "replaces the SGA slots; `sga_schedule` then holds the originals). `corrections` lists "
            + "open corrections; `my_vote` is filled when the caller is logged in.")
    public Map<String, Map<String, Map<String, List<OrganizedSubjectsResponse.SubjectDetail>>>>
            getSubjectsByPlan(@Parameter(description = "Plan identifier (e.g. S10-Rev23)")
                              @RequestParam String plan,
                              @CurrentUser User viewer) {
        return subjectPlanService.getSubjectsByPlanOrganized(plan, viewer != null ? viewer.getId() : null);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a subject by ID")
    public SubjectResponse getSubjectById(@PathVariable String id) {
        return subjectService.getSubjectById(id);
    }
}
