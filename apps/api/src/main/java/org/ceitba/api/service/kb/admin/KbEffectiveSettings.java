package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;

// The pipeline settings in force: env defaults overridden by
// kb_pipeline_settings (docs/SUBJECT-WIKI-ADMIN.md §1).
// subjectOverrides: {"<subjectId>": {modelWrite?, modelPlan?, paused?}}.
// reasoningEffort / maxTokens: {digest, plan, write, retry} (defaults
// low/low/medium/medium and 4000/6000/12000/12000; GLM is a reasoning model
// that spends small budgets thinking and returns empty tool arguments).
public record KbEffectiveSettings(
    String modelDigest,
    String modelPlan,
    String modelWrite,
    String modelRetry,
    String executionMode,
    boolean enabled,
    String cron,
    long runTokenBudget,
    BigDecimal weeklyCostLimitUsd,
    boolean retryRejected,
    JsonNode subjectOverrides,
    JsonNode reasoningEffort,
    JsonNode maxTokens,
    boolean autoRefreshPrices
) {
    // Keys: digest, plan, write, retry (ADMIN doc §8).
    public static final java.util.Map<String, String> DEFAULT_EFFORT =
        java.util.Map.of("digest", "low", "plan", "low", "write", "medium", "retry", "medium");
    public static final java.util.Map<String, Integer> DEFAULT_MAX_TOKENS =
        java.util.Map.of("digest", 4000, "plan", 6000, "write", 12000, "retry", 12000);

    // reasoning_effort for a stage (DIGEST | PLAN | WRITE | RETRY, any case):
    // low | medium | high, or null = the model's default (not sent). Only
    // applied to models whose catalog entry supportsReasoningEffort.
    public String reasoningEffort(String stage) {
        var key = stage.toLowerCase(java.util.Locale.ROOT);
        var v = reasoningEffort.path(key);
        if (v.isNull()) return null;
        return v.isTextual() ? v.asText() : DEFAULT_EFFORT.get(key);
    }

    public int maxTokens(String stage) {
        var key = stage.toLowerCase(java.util.Locale.ROOT);
        var v = maxTokens.path(key);
        return v.canConvertToInt() ? v.asInt() : DEFAULT_MAX_TOKENS.getOrDefault(key, 8000);
    }

    public String planModelFor(String subjectId) {
        var o = subjectOverrides.path(subjectId).path("modelPlan");
        return o.isTextual() ? o.asText() : modelPlan;
    }

    public String writeModelFor(String subjectId) {
        var o = subjectOverrides.path(subjectId).path("modelWrite");
        return o.isTextual() ? o.asText() : modelWrite;
    }

    // A subject-level write override also drives its retries.
    public String retryModelFor(String subjectId) {
        var o = subjectOverrides.path(subjectId).path("modelWrite");
        return o.isTextual() ? o.asText() : modelRetry;
    }

    public boolean paused(String subjectId) {
        return subjectOverrides.path(subjectId).path("paused").asBoolean(false);
    }
}
