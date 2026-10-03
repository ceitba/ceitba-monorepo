package org.ceitba.api.web.kb.admin;

import java.math.BigDecimal;
import java.util.Map;

// GET/POST /costs/forecast (ADMIN doc §7). Effective (batch-discounted where
// batched) prices; mode is batch | sync.
public record KbForecastResponse(
    String settingsHash,
    NextRun nextRun,
    Weekly weekly,
    Range monthly,
    Tokens fullRebuild,
    Savings savings,
    Limits limits,
    boolean discountIsEstimate
) {
    public record Stage(String model, String mode, long inputTokens, long cachedInputTokens, long outputTokens,
                        BigDecimal costUsd) {}

    public record NextRun(int dirtySubjects, Map<String, Stage> perStage, BigDecimal totalUsd) {}

    // basis: history | corpus | blend; runsUsed: completed scheduled runs used.
    // includesBacklog: the estimate was raised to the pending backlog
    // (nextRun.totalUsd), which a week can't cost less than.
    public record Weekly(BigDecimal expectedUsd, BigDecimal low, BigDecimal high, String basis, int runsUsed,
                         boolean includesBacklog) {}

    public record Range(BigDecimal expectedUsd, BigDecimal low, BigDecimal high) {}

    public record Tokens(long inputTokens, long outputTokens, BigDecimal costUsd) {}

    public record Savings(BigDecimal batchUsd, BigDecimal cacheUsd) {}

    public record Limits(BigDecimal weeklyCostLimitUsd, boolean exceedsLimit) {}
}
