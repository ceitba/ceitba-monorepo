package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.config.KbPipelineProperties;
import org.ceitba.api.domain.kb.KbPipelineSettingsHistory;
import org.ceitba.api.domain.kb.KbPipelineSettingsRow;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbPipelineSettingsHistoryRepository;
import org.ceitba.api.repository.kb.KbPipelineSettingsRowRepository;
import org.ceitba.api.service.kb.llm.KbChatPayloads;
import org.ceitba.api.web.kb.admin.KbSettingsHistoryResponse;
import org.ceitba.api.web.kb.admin.KbSettingsResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// Runtime pipeline settings (docs/SUBJECT-WIKI-ADMIN.md §1): env defaults
// overridden by the single kb_pipeline_settings row, every change kept in
// kb_pipeline_settings_history. Read at each stage submission.
@Service
public class KbSettingsService {

    public static final List<String> FIELDS = List.of("modelDigest", "modelPlan", "modelWrite", "modelRetry",
        "executionMode", "enabled", "cron", "runTokenBudget", "weeklyCostLimitUsd", "retryRejected",
        "subjectOverrides", "reasoningEffort", "maxTokens", "autoRefreshPrices");
    static final List<String> STAGES = List.of("digest", "plan", "write", "retry");
    private static final Set<String> MODEL_FIELDS = Set.of("modelDigest", "modelPlan", "modelWrite", "modelRetry");

    private final KbPipelineSettingsRowRepository rows;
    private final KbPipelineSettingsHistoryRepository history;
    private final KbModelRepository models;
    private final KbPipelineProperties env;
    private final KbLlmProperties llmEnv;
    private final KbForecastService forecast;
    private final ObjectMapper json;
    private final Clock clock;
    private final org.ceitba.api.repository.UserRepository users;

    public KbSettingsService(KbPipelineSettingsRowRepository rows, KbPipelineSettingsHistoryRepository history,
                             KbModelRepository models, KbPipelineProperties env, KbLlmProperties llmEnv,
                             KbForecastService forecast, ObjectMapper json, Clock clock,
                             org.ceitba.api.repository.UserRepository users) {
        this.users = users;
        this.rows = rows;
        this.history = history;
        this.models = models;
        this.env = env;
        this.llmEnv = llmEnv;
        this.forecast = forecast;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public KbEffectiveSettings effective() {
        return merge(stored());
    }

    @Transactional(readOnly = true)
    public KbSettingsResponse get() {
        var row = rows.findById(KbPipelineSettingsRow.ID).orElse(null);
        return response(row == null ? json.createObjectNode() : (ObjectNode) row.getSettings(), row, null);
    }

    // Applies the given fields (null = back to the env default; absent =
    // unchanged), validates them and records a history entry. Anything that
    // is not a settings field (costImpact, source, updatedAt, ...: the
    // response echoed back) is ignored, and a value that changes nothing
    // effective (e.g. equal to the env default) is stored as "use env".
    @Transactional
    public KbSettingsResponse update(UUID userId, JsonNode body) {
        var before = effective();
        checkTypes(body);
        var next = applied(stored(), body);
        validate(next, body, before);
        var note = body.path("note").isTextual() ? body.path("note").asText() : null;
        var row = save(next, userId, note);
        var after = merge(next);
        return response(next, row, impact(before, after));
    }

    // Same body as update(): the cost impact and validation errors, nothing saved.
    @Transactional(readOnly = true)
    public KbSettingsPreview preview(JsonNode body) {
        var before = effective();
        var errors = new ArrayList<String>();
        ObjectNode next = stored();
        try {
            checkTypes(body);
            next = applied(next, body);
            validate(next, body, before);
        } catch (ValidationException e) {
            errors.add(e.getMessage());
        }
        return new KbSettingsPreview(impact(before, merge(next)), errors);
    }

    public record KbSettingsPreview(KbSettingsResponse.CostImpact costImpact, List<String> errors) {}

    // The settings `body` would produce (no validation, nothing saved): what
    // the forecast prices for proposed settings.
    @Transactional(readOnly = true)
    public KbEffectiveSettings proposed(JsonNode body) {
        return merge(body == null ? stored() : applied(stored(), body));
    }

    // `stored` with the settings fields of `body` applied (null removes),
    // then every override from `body` that changes no effective value
    // dropped, so resending a default never pins it in the database.
    ObjectNode applied(ObjectNode stored, JsonNode body) {
        var next = stored.deepCopy();
        for (var f : FIELDS) {
            if (!body.has(f)) continue;
            if (body.get(f).isNull()) next.remove(f);
            else next.set(f, body.get(f));
        }
        normalizeCron(next);
        for (var f : FIELDS) {
            if (!body.hasNonNull(f) || !next.has(f)) continue;
            var without = next.deepCopy();
            without.remove(f);
            if (values(merge(next)).equals(values(merge(without)))) next.remove(f);
        }
        return next;
    }

    // Each settings field present (and not null) must have its JSON type: a
    // string "25" or "yes" is refused instead of being read as 0 / false.
    static void checkTypes(JsonNode s) {
        for (var f : FIELDS) {
            var v = s.get(f);
            if (v == null || v.isNull()) continue;
            switch (f) {
                case "enabled", "retryRejected", "autoRefreshPrices" -> {
                    if (!v.isBoolean()) throw new ValidationException(f, v, "must be true or false");
                }
                case "runTokenBudget" -> {
                    if (!v.isIntegralNumber()) throw new ValidationException(f, v, "must be a whole number");
                }
                case "weeklyCostLimitUsd" -> {
                    if (!v.isNumber()) throw new ValidationException(f, v, "must be a number (US$) or null");
                }
                case "subjectOverrides", "reasoningEffort", "maxTokens" -> {
                    if (!v.isObject()) throw new ValidationException(f, v, "must be an object");
                }
                default -> {
                    if (!v.isTextual()) throw new ValidationException(f, v, "must be text");
                }
            }
        }
    }

    private KbSettingsResponse.CostImpact impact(KbEffectiveSettings before, KbEffectiveSettings after) {
        var previous = forecast.forecast(before).weekly();
        var projected = forecast.forecast(after).weekly();
        return new KbSettingsResponse.CostImpact(previous, projected);
    }

    @Transactional(readOnly = true)
    public List<KbSettingsHistoryResponse> history(int limit) {
        return history.findAllByOrderByChangedAtDesc(PageRequest.of(0, Math.max(1, Math.min(limit, 200)))).stream()
            .map(h -> new KbSettingsHistoryResponse(h.getId(), h.getSettings(), h.getChangedBy(),
                userName(h.getChangedBy()), h.getChangedAt(), h.getNote()))
            .toList();
    }

    @Transactional
    public KbSettingsResponse restore(UUID userId, UUID historyId) {
        var h = history.findById(historyId)
            .orElseThrow(() -> new ResourceNotFoundException("KbSettingsHistory", historyId.toString()));
        var before = effective();
        var next = (ObjectNode) h.getSettings().deepCopy();
        validate(next, json.createObjectNode(), before);
        var row = save(next, userId, "restored from " + historyId);
        return response(next, row, impact(before, merge(next)));
    }

    // ---- internals ---------------------------------------------------------------

    // Cron is Spring's 6 fields (seconds first); a standard 5-field
    // expression is accepted and stored with "0 " in front.
    static String cron6(String cron) {
        if (cron == null) return null;
        var parts = cron.trim().split("\\s+");
        return parts.length == 5 ? "0 " + String.join(" ", parts) : String.join(" ", parts);
    }

    private static void normalizeCron(ObjectNode settings) {
        if (settings.path("cron").isTextual()) settings.put("cron", cron6(settings.get("cron").asText()));
    }

    private ObjectNode stored() {
        return rows.findById(KbPipelineSettingsRow.ID).map(r -> (ObjectNode) r.getSettings().deepCopy())
            .orElseGet(json::createObjectNode);
    }

    private KbPipelineSettingsRow save(ObjectNode settings, UUID userId, String note) {
        var now = OffsetDateTime.now(clock);
        var row = rows.findById(KbPipelineSettingsRow.ID).orElse(null);
        if (row == null) row = new KbPipelineSettingsRow(settings, userId, now);
        else row.update(settings, userId, now);
        row = rows.save(row);
        history.save(new KbPipelineSettingsHistory(settings.deepCopy(), userId, now, note));
        return row;
    }

    KbEffectiveSettings merge(JsonNode s) {
        var write = text(s, "modelWrite", env.modelWrite());
        return new KbEffectiveSettings(
            text(s, "modelDigest", env.modelDigest()),
            text(s, "modelPlan", env.modelPlan()),
            write,
            text(s, "modelRetry", s.has("modelWrite") && !s.has("modelRetry") ? write : env.modelRetry()),
            text(s, "executionMode", llmEnv.executionMode()),
            s.has("enabled") ? s.get("enabled").asBoolean() : env.enabled(),
            cron6(text(s, "cron", env.cron())),
            s.has("runTokenBudget") ? s.get("runTokenBudget").asLong() : env.runTokenBudget(),
            s.hasNonNull("weeklyCostLimitUsd") ? s.get("weeklyCostLimitUsd").decimalValue() : null,
            s.has("retryRejected") ? s.get("retryRejected").asBoolean() : env.retryRejected(),
            s.has("subjectOverrides") ? s.get("subjectOverrides") : json.createObjectNode(),
            perStage(s.path("reasoningEffort"), true),
            perStage(s.path("maxTokens"), false),
            !s.has("autoRefreshPrices") || s.get("autoRefreshPrices").asBoolean(true));
    }

    // Defaults overlaid with the stored per-stage values.
    private JsonNode perStage(JsonNode stored, boolean effort) {
        var out = json.createObjectNode();
        for (var st : STAGES) {
            if (stored.has(st)) out.set(st, stored.get(st));
            else if (effort) out.put(st, KbEffectiveSettings.DEFAULT_EFFORT.get(st));
            else out.put(st, KbEffectiveSettings.DEFAULT_MAX_TOKENS.get(st));
        }
        return out;
    }

    private static String text(JsonNode s, String f, String fallback) {
        return s.hasNonNull(f) && s.get(f).isTextual() && !s.get(f).asText().isBlank() ? s.get(f).asText().trim() : fallback;
    }

    // Every model field that changes must name an enabled catalog model
    // with a successful probe; batch mode needs batch support everywhere.
    private void validate(ObjectNode next, JsonNode body, KbEffectiveSettings before) {
        checkTypes(next);
        var merged = merge(next);
        Map<String, String> chosen = new LinkedHashMap<>();
        chosen.put("modelDigest", merged.modelDigest());
        chosen.put("modelPlan", merged.modelPlan());
        chosen.put("modelWrite", merged.modelWrite());
        chosen.put("modelRetry", merged.modelRetry());
        Map<String, String> previous = Map.of("modelDigest", before.modelDigest(), "modelPlan", before.modelPlan(),
            "modelWrite", before.modelWrite(), "modelRetry", before.modelRetry());
        for (var f : MODEL_FIELDS) {
            if (next.has(f) && !next.get(f).isTextual()) throw new ValidationException(f, next.get(f), "must be a model id");
        }
        for (var e : chosen.entrySet()) {
            if (e.getValue().equals(previous.get(e.getKey()))) continue;
            checkModel(e.getKey(), e.getValue(), merged.executionMode());
        }
        var overrides = merged.subjectOverrides();
        if (!overrides.isObject()) throw new ValidationException("subjectOverrides", overrides, "must be an object");
        var it = overrides.fields();
        while (it.hasNext()) {
            var o = it.next();
            if (!o.getValue().isObject()) throw new ValidationException("subjectOverrides", o.getKey(), "must be an object");
            for (var f : List.of("modelWrite", "modelPlan")) {
                var v = o.getValue().path(f);
                if (v.isMissingNode() || v.isNull()) continue;
                var prev = before.subjectOverrides().path(o.getKey()).path(f);
                if (!v.equals(prev)) checkModel("subjectOverrides." + o.getKey() + "." + f, v.asText(), merged.executionMode());
                chosen.put("subjectOverrides." + o.getKey() + "." + f, v.asText());
            }
        }
        var mode = merged.executionMode();
        if (!List.of("auto", "batch", "sync").contains(mode)) {
            throw new ValidationException("executionMode", mode, "must be auto, batch or sync");
        }
        if (mode.equals("batch")) {
            var noBatch = new ArrayList<String>();
            for (var e : chosen.entrySet()) {
                var m = models.findById(e.getValue()).orElse(null);
                boolean supported = m != null ? m.isBatchSupported() : KbChatPayloads.batchProvider(e.getValue()) != null;
                if (!supported) noBatch.add(e.getValue());
            }
            if (!noBatch.isEmpty()) {
                throw new ValidationException("executionMode", mode, "these models have no batch support: " + noBatch);
            }
        }
        for (var st : STAGES) {
            var e = merged.reasoningEffort().path(st);
            if (!e.isNull() && !(e.isTextual() && List.of("low", "medium", "high").contains(e.asText()))) {
                throw new ValidationException("reasoningEffort." + st, e, "must be low, medium, high or null");
            }
            var t = merged.maxTokens().path(st);
            if (!t.canConvertToInt() || t.asInt() < 256 || t.asInt() > 32000) {
                throw new ValidationException("maxTokens." + st, t, "must be between 256 and 32000");
            }
        }
        if (!CronExpression.isValidExpression(merged.cron())) {
            throw new ValidationException("cron", merged.cron(), "not a valid cron expression (Spring 6 fields with seconds, or standard 5 fields)");
        }
        if (merged.runTokenBudget() <= 0) {
            throw new ValidationException("runTokenBudget", merged.runTokenBudget(), "must be positive");
        }
        if (merged.weeklyCostLimitUsd() != null && merged.weeklyCostLimitUsd().compareTo(BigDecimal.ZERO) < 0) {
            throw new ValidationException("weeklyCostLimitUsd", merged.weeklyCostLimitUsd(), "must be >= 0");
        }
    }

    void checkModel(String field, String id, String executionMode) {
        var m = models.findById(id)
            .orElseThrow(() -> new ValidationException(field, id, "not in the model catalog"));
        if (!m.isEnabled()) throw new ValidationException(field, id, "is disabled in the catalog");
        var mode = m.modeFor(executionMode);
        if (!m.selectableIn(mode)) {
            throw new ValidationException(field, id, "has no successful " + mode.toLowerCase(java.util.Locale.ROOT)
                + " probe yet");
        }
    }

    private KbSettingsResponse response(ObjectNode stored, KbPipelineSettingsRow row, KbSettingsResponse.CostImpact impact) {
        var values = values(merge(stored));
        var source = json.createObjectNode();
        for (var f : FIELDS) {
            boolean db = stored.has(f) || (f.equals("modelRetry") && stored.has("modelWrite"));
            source.put(f, db ? "db" : "env");
        }
        return new KbSettingsResponse(values, source, row == null ? null : row.getUpdatedAt(),
            row == null ? null : row.getUpdatedBy(), row == null ? null : userName(row.getUpdatedBy()), impact);
    }

    // Every field's effective value.
    private ObjectNode values(KbEffectiveSettings e) {
        var values = json.createObjectNode();
        values.put("modelDigest", e.modelDigest());
        values.put("modelPlan", e.modelPlan());
        values.put("modelWrite", e.modelWrite());
        values.put("modelRetry", e.modelRetry());
        values.put("executionMode", e.executionMode());
        values.put("enabled", e.enabled());
        values.put("cron", e.cron());
        values.put("runTokenBudget", e.runTokenBudget());
        if (e.weeklyCostLimitUsd() == null) values.putNull("weeklyCostLimitUsd");
        else values.put("weeklyCostLimitUsd", e.weeklyCostLimitUsd());
        values.put("retryRejected", e.retryRejected());
        values.set("subjectOverrides", e.subjectOverrides());
        values.set("reasoningEffort", e.reasoningEffort());
        values.set("maxTokens", e.maxTokens());
        values.put("autoRefreshPrices", e.autoRefreshPrices());
        return values;
    }

    private String userName(UUID id) {
        return id == null ? null : users.findById(id).map(org.ceitba.api.domain.User::getName).orElse(null);
    }
}
