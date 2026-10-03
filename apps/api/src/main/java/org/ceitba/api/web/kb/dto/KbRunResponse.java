package org.ceitba.api.web.kb.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// A pipeline run. status: RUNNING | WAITING (a DO batch is out) |
// BLOCKED_BY_COST_LIMIT (approve-cost) | SUCCEEDED | FAILED | CANCELLED;
// costUsd (= costEstimate): recorded usage at the catalog prices of the run;
// expectedCostUsd: the forecast when the run was detected;
// costByStage: {DIGEST, PLAN, WRITE, RETRY} (detail only);
// simulated: produced by the fake executors; stage: DETECT | DIGEST | PLAN | WRITE | RETRY | PUBLISH | DONE.
// subjects/batches are only filled on GET .../runs/{id}.
public record KbRunResponse(
    UUID id,
    String trigger,
    String status,
    String stage,
    boolean dryRun,
    String promptVersion,
    String model,
    OffsetDateTime startedAt,
    OffsetDateTime finishedAt,
    long estimatedTokens,
    long tokensIn,
    long tokensOut,
    long tokensCached,
    BigDecimal costEstimate,
    BigDecimal costUsd,
    BigDecimal expectedCostUsd,
    java.util.Map<String, BigDecimal> costByStage,
    boolean costApproved,
    boolean simulated,
    String error,
    List<KbRunSubjectResponse> subjects,
    List<KbBatchJobResponse> batches,
    KbProgressResponse progress
) {}
