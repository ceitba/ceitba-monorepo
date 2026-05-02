package org.ceitba.api.web.sync;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.external.itba.CommissionQuery;
import org.ceitba.api.service.sync.DataSyncResult;
import org.ceitba.api.service.sync.DataSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Data Sync")
@RestController
@RequestMapping("/v1/sync")
public class DataSyncController {

    private final DataSyncService dataSyncService;

    public DataSyncController(DataSyncService dataSyncService) {
        this.dataSyncService = dataSyncService;
    }

    @PostMapping("/all")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Manually trigger full data synchronization")
    public DataSyncResult syncAll(
        @RequestParam(required = false) Integer year,
        @RequestParam(required = false) String period,
        @RequestParam(required = false) String levels
    ) {
        return dataSyncService.syncAll(buildQuery(year, period, levels));
    }

    @PostMapping("/subjects")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Manually trigger subjects synchronization")
    public DataSyncResult syncSubjects() {
        return dataSyncService.syncSubjectsAndPlansOnly();
    }

    @PostMapping("/commissions")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Manually trigger commissions synchronization")
    public DataSyncResult syncCommissions(
        @RequestParam(required = false) Integer year,
        @RequestParam(required = false) String period,
        @RequestParam(required = false) String levels
    ) {
        return dataSyncService.syncCommissionsOnly(buildQuery(year, period, levels));
    }

    @PostMapping("/plan/{planId}/subjects")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Sync subjects for a specific plan")
    public Object syncSubjectsByPlan(@PathVariable String planId) {
        return dataSyncService.syncByPlan(planId);
    }

    @PostMapping("/subject/{subjectCode}/commissions")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Sync commissions for a specific subject")
    public Object syncCommissionsBySubject(
        @PathVariable String subjectCode,
        @RequestParam(required = false) Integer year,
        @RequestParam(required = false) String period,
        @RequestParam(required = false) String levels
    ) {
        return dataSyncService.syncCommissionsBySubject(subjectCode, buildQuery(year, period, levels));
    }

    private CommissionQuery buildQuery(Integer year, String period, String levels) {
        if (year == null && period == null && (levels == null || levels.isBlank())) {
            return null; // service applies defaults
        }
        List<String> levelList = null;
        if (levels != null && !levels.isBlank()) {
            levelList = java.util.Arrays.stream(levels.split(","))
                .map(String::trim)
                .filter(l -> "GRADUATE".equals(l) || "UNDERGRADUATE".equals(l))
                .toList();
        }
        return new CommissionQuery(year, period, levelList);
    }
}
