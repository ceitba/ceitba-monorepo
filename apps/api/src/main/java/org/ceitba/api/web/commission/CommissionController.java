package org.ceitba.api.web.commission;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.commission.CommissionService;
import org.ceitba.api.web.commission.dto.CommissionResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Commissions")
@RestController
@RequestMapping("/v1/commissions")
public class CommissionController {

    private final CommissionService commissionService;

    public CommissionController(CommissionService commissionService) {
        this.commissionService = commissionService;
    }

    @GetMapping
    @Operation(summary = "Current commissions of a plan's subjects",
        description = "Flat list of commissions (course_end >= today, ART) whose subject "
            + "belongs to the plan, served from the DB sync cache.")
    public List<CommissionResponse> list(@RequestParam String plan) {
        return commissionService.currentByPlan(plan);
    }
}
