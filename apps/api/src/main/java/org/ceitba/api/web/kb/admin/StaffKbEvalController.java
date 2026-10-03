package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.eval.KbEvalService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// Model evaluations (docs/SUBJECT-WIKI-ADMIN.md §4, §6, §8). Evals never publish.
@Tag(name = "Subject wikis - evals")
@RestController
@RequestMapping("/v1/staff/kb/evals")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffKbEvalController {

    private final KbEvalService evals;

    public StaffKbEvalController(KbEvalService evals) {
        this.evals = evals;
    }

    @GetMapping("/sets")
    @Operation(summary = "Benchmark sets (\"Básico\" is created on first use)")
    public List<KbEvalDtos.EvalSet> sets() {
        return evals.sets();
    }

    @PostMapping("/sets")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a set {name, subjectIds}; its inputs are frozen now")
    public KbEvalDtos.EvalSet createSet(@CurrentUser User user, @RequestBody JsonNode body) {
        var ids = new ArrayList<String>();
        body.path("subjectIds").forEach(n -> ids.add(n.asText()));
        return evals.createSet(body.path("name").asText(null), ids, user.getId());
    }

    @PostMapping("/sets/{id}/refreeze")
    @Operation(summary = "Freeze the set's current inputs again (later evals use the new snapshot)")
    public KbEvalDtos.EvalSet refreeze(@PathVariable UUID id) {
        return evals.refreeze(id);
    }

    @PostMapping("/estimate")
    @Operation(summary = "Estimated tokens and cost of an eval {setId, models}")
    public KbEvalDtos.Estimate estimate(@RequestBody JsonNode body) {
        return evals.estimate(setId(body), body.path("models"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Start an eval {setId, models:[{plan, write, reasoningEffort?}], note?}; 409 KB_EVAL_ACTIVE")
    public KbEvalDtos.Eval create(@CurrentUser User user, @RequestBody JsonNode body) {
        return evals.create(setId(body), body.path("models"), body.path("note").asText(null), user.getId());
    }

    @GetMapping
    @Operation(summary = "Evals, newest first")
    public List<KbEvalDtos.Eval> list(@RequestParam(required = false) UUID setId,
                                      @RequestParam(defaultValue = "20") int limit) {
        return evals.list(setId, limit);
    }

    @GetMapping("/leaderboard")
    @Operation(summary = "Configurations of a set (default Básico) ranked by blind win rate, with metrics and cost")
    public KbEvalDtos.Leaderboard leaderboard(@RequestParam(required = false) UUID setId) {
        return evals.leaderboard(setId);
    }

    @GetMapping("/{id}")
    @Operation(summary = "An eval with per-configuration metrics and per-subject pages")
    public KbEvalDtos.Eval get(@PathVariable UUID id) {
        return evals.get(id);
    }

    @PostMapping("/{id}/cancel")
    @Operation(summary = "Cancel a running eval")
    public KbEvalDtos.Eval cancel(@PathVariable UUID id) {
        return evals.cancel(id);
    }

    @GetMapping("/{id}/pages")
    @Operation(summary = "A page an eval configuration wrote")
    public KbEvalDtos.ReviewPage page(@PathVariable UUID id, @RequestParam String configKey,
                                      @RequestParam String subjectId, @RequestParam String slug) {
        return evals.page(id, configKey, subjectId, slug);
    }

    @GetMapping("/{id}/review/next")
    @Operation(summary = "The next blind A/B pair for this reviewer; 204 when none is left")
    public ResponseEntity<KbEvalDtos.ReviewPair> next(@CurrentUser User user, @PathVariable UUID id,
                                                      @RequestParam(required = false) String subjectId,
                                                      @RequestParam(required = false) String slug) {
        var pair = evals.next(id, user.getId(), subjectId, slug);
        return pair == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(pair);
    }

    @PostMapping("/{id}/review")
    @Operation(summary = "Rate the pending pair {subjectId, slug, winner: A|B|tie, scoresA, scoresB, comment}")
    public KbEvalDtos.ReviewResult review(@CurrentUser User user, @PathVariable UUID id, @RequestBody JsonNode body) {
        return evals.review(id, user.getId(), body);
    }

    @PostMapping("/{id}/promote")
    @Operation(summary = "Copy a configuration's models into the settings {configKey}")
    public KbSettingsResponse promote(@CurrentUser User user, @PathVariable UUID id, @RequestBody JsonNode body) {
        return evals.promote(id, body.path("configKey").asText(null), user.getId());
    }

    private static UUID setId(JsonNode body) {
        try {
            return UUID.fromString(body.path("setId").asText(""));
        } catch (IllegalArgumentException e) {
            throw new ValidationException("setId", body.path("setId"), "required UUID");
        }
    }
}
