package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.admin.KbModelCatalogService;
import org.ceitba.api.service.kb.eval.KbEvalService;
import org.ceitba.api.service.kb.pipeline.KbPipelineService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.kb.dto.KbBaselineResponse;
import org.ceitba.api.web.kb.dto.KbPreviewResponse;
import org.ceitba.api.web.kb.dto.KbRunResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Wiki self-update pipeline (docs/SUBJECT-WIKI-PIPELINE.md, ADMIN doc §6).
@Tag(name = "Subject wikis - pipeline")
@RestController
@RequestMapping("/v1/staff/kb/pipeline")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffKbPipelineController {

    private final KbPipelineService pipeline;
    private final KbModelCatalogService catalog;
    private final KbEvalService evals;

    public StaffKbPipelineController(KbPipelineService pipeline, KbModelCatalogService catalog, KbEvalService evals) {
        this.pipeline = pipeline;
        this.catalog = catalog;
        this.evals = evals;
    }

    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Start a manual run (dryRun stops after PLAN and publishes nothing); 409 while one is active")
    public KbRunResponse trigger(@RequestParam(defaultValue = "false") boolean dryRun) {
        return pipeline.trigger("MANUAL", dryRun);
    }

    @GetMapping("/runs")
    @Operation(summary = "Recent pipeline runs, newest first")
    public List<KbRunResponse> runs(@RequestParam(defaultValue = "20") int limit) {
        return pipeline.runs(limit);
    }

    @GetMapping("/runs/{id}")
    @Operation(summary = "A run with its subjects, batches and costs")
    public KbRunResponse run(@PathVariable UUID id) {
        return pipeline.run(id);
    }

    @GetMapping("/runs/{id}/progress")
    @Operation(summary = "Just the progress of a run (cheap; for polling every few seconds)")
    public org.ceitba.api.web.kb.dto.KbProgressResponse progress(@PathVariable UUID id) {
        return pipeline.progress(id);
    }

    @PostMapping("/runs/{id}/cancel")
    @Operation(summary = "Cancel an active run (cancels its open batches)")
    public KbRunResponse cancel(@PathVariable UUID id) {
        return pipeline.cancel(id);
    }

    @PostMapping("/runs/{id}/approve-cost")
    @Operation(summary = "Let a run blocked by the weekly cost limit continue")
    public KbRunResponse approveCost(@PathVariable UUID id) {
        return pipeline.approveCost(id);
    }

    @PostMapping("/baseline")
    @Operation(summary = "Record the current inputs as already processed (no LLM requests)")
    public KbBaselineResponse baseline() {
        return pipeline.baseline();
    }

    @GetMapping("/preview")
    @Operation(summary = "What the next run would do (changed subjects and files), without requests")
    public KbPreviewResponse preview() {
        return pipeline.preview();
    }

    @PostMapping("/probe")
    @Operation(summary = "Probe a model {model, mode?}: one tiny structured request; result stored in the catalog")
    public KbModelResponse probe(@RequestBody JsonNode body) {
        var model = body == null ? null : body.path("model").asText(null);
        if (model == null || model.isBlank()) throw new ValidationException("model", model, "required");
        return catalog.probe(model, body.path("mode").asText(null));
    }

    @PostMapping("/compare")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Alias: an eval of one subject {subjectId, models:[{plan, write, reasoningEffort?}]}")
    public KbEvalDtos.Eval compare(@CurrentUser User user, @RequestBody JsonNode body) {
        return evals.compare(body.path("subjectId").asText(null), body.path("models"), user.getId());
    }
}
