package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.admin.KbCostService;
import org.ceitba.api.service.kb.admin.KbForecastService;
import org.ceitba.api.service.kb.admin.KbModelCatalogService;
import org.ceitba.api.service.kb.admin.KbSettingsService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

// Runtime settings, model catalog and costs (docs/SUBJECT-WIKI-ADMIN.md).
@Tag(name = "Subject wikis - admin")
@RestController
@RequestMapping("/v1/staff/kb")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffKbAdminController {

    private static final Set<String> STAGES = Set.of("digest", "plan", "write", "retry");

    private final KbSettingsService settings;
    private final KbModelCatalogService catalog;
    private final KbCostService costs;
    private final KbForecastService forecast;
    private final ObjectMapper json;

    public StaffKbAdminController(KbSettingsService settings, KbModelCatalogService catalog, KbCostService costs,
                                  KbForecastService forecast, ObjectMapper json) {
        this.settings = settings;
        this.catalog = catalog;
        this.costs = costs;
        this.forecast = forecast;
        this.json = json;
    }

    // ---- settings ----

    @GetMapping("/settings")
    @Operation(summary = "Effective runtime settings (stored overrides on top of the environment)")
    public KbSettingsResponse settings() {
        return settings.get();
    }

    @PutMapping("/settings")
    @Operation(summary = "Change settings (validated, versioned); returns costImpact")
    public KbSettingsResponse update(@CurrentUser User user, @RequestBody JsonNode body) {
        return settings.update(user.getId(), body);
    }

    @PostMapping("/settings/preview")
    @Operation(summary = "Validation errors and cost impact of proposed settings, nothing saved")
    public KbSettingsService.KbSettingsPreview preview(@RequestBody JsonNode body) {
        return settings.preview(body);
    }

    @GetMapping("/settings/history")
    @Operation(summary = "Previous settings versions, newest first")
    public List<KbSettingsHistoryResponse> history(@RequestParam(defaultValue = "50") int limit) {
        return settings.history(limit);
    }

    @PostMapping("/settings/history/{id}/restore")
    @Operation(summary = "Restore a previous settings version (recorded as a new version)")
    public KbSettingsResponse restore(@CurrentUser User user, @PathVariable UUID id) {
        return settings.restore(user.getId(), id);
    }

    // ---- models ----

    @GetMapping("/models")
    @Operation(summary = "Model catalog with effective prices, batch support and last probe")
    public List<KbModelResponse> models() {
        return catalog.list();
    }

    @PostMapping("/models")
    @Operation(summary = "Add a model to the catalog")
    public KbModelResponse create(@RequestBody JsonNode body) {
        return catalog.create(body);
    }

    @PutMapping("/models/{id}")
    @Operation(summary = "Edit a model (prices, batchDiscount, enabled, ...)")
    public KbModelResponse updateModel(@PathVariable String id, @RequestBody JsonNode body) {
        return catalog.update(id, body);
    }

    @PostMapping("/models/sync")
    @Operation(summary = "Compare the catalog with the provider's /v1/models")
    public KbModelSyncResponse sync() {
        return catalog.sync();
    }

    @PostMapping("/models/{id}/probe")
    @Operation(summary = "Probe a model (one tiny structured request); mode=batch|sync overrides the routed mode")
    public KbModelResponse probe(@PathVariable String id, @RequestParam(required = false) String mode) {
        return catalog.probe(id, mode);
    }

    @GetMapping("/models/{id}/stage-cost")
    @Operation(summary = "Expected weekly cost with this model in a stage, other settings unchanged")
    public KbStageCostResponse stageCost(@PathVariable String id, @RequestParam String stage) {
        var key = stage.toLowerCase(java.util.Locale.ROOT);
        if (!STAGES.contains(key)) throw new ValidationException("stage", stage, "must be digest, plan, write or retry");
        var body = json.createObjectNode();
        body.put("model" + Character.toUpperCase(key.charAt(0)) + key.substring(1), id);
        return forecast.stageCost(settings.proposed(body), id, key);
    }

    // ---- costs ----

    @GetMapping("/costs")
    @Operation(summary = "Recorded LLM usage grouped by week, model, stage, subject (or week,stage / week,model)")
    public List<KbCostRowResponse> costs(
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
        @RequestParam(defaultValue = "week") String groupBy,
        @RequestParam(defaultValue = "false") boolean reprice) {
        return costs.costs(from, to, groupBy, reprice);
    }

    @GetMapping("/costs/summary")
    @Operation(summary = "Last 7 / 30 days, projection, by stage and model, top subjects, forecast accuracy")
    public KbCostSummaryResponse summary() {
        return costs.summary();
    }

    @GetMapping("/costs/forecast")
    @Operation(summary = "Expected cost of the next run, a week, a month and a full rebuild (settings= proposed JSON)")
    public KbForecastResponse forecast(@RequestParam(required = false, name = "settings") String proposed) {
        if (proposed == null || proposed.isBlank()) return forecast.forecast(settings.effective());
        try {
            return forecast.forecast(settings.proposed(json.readTree(proposed)));
        } catch (java.io.IOException e) {
            throw new ValidationException("settings", proposed, "not valid JSON");
        }
    }

    @PostMapping("/costs/forecast")
    @Operation(summary = "Forecast for proposed settings (body: a settings object)")
    public KbForecastResponse forecastFor(@RequestBody(required = false) JsonNode body) {
        return forecast.forecast(body == null ? settings.effective() : settings.proposed(body));
    }
}
