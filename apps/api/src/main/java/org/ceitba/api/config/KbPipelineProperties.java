package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// Env defaults of the subject wiki pipeline (docs/SUBJECT-WIKI-PIPELINE.md),
// bound from kb.pipeline.*. STAFF can override most of them at runtime
// (kb_pipeline_settings, docs/SUBJECT-WIKI-ADMIN.md):
//   KB_PIPELINE_ENABLED=false        weekly scheduled run (manual runs always work)
//   KB_PIPELINE_CRON="0 0 3 * * SUN" Spring cron, America/Argentina/Buenos_Aires
//   KB_POLL_INTERVAL=PT10M           safety sweep (runs advance as soon as triggered)
//   KB_BATCH_POLL_INTERVAL=PT1M      DO batch status polling (only while a batch is open)
//   KB_MODEL_DIGEST=glm-5.3-flash, KB_MODEL_PLAN=glm-5.3, KB_MODEL_WRITE=glm-5.3,
//   KB_MODEL_RETRY=(write model)
//   KB_RUN_TOKEN_BUDGET=3000000      estimated input tokens per run
//   KB_RUN_COST_BUDGET_USD=5.00      estimated cost per run (admission and deferral); 0.10-100
//   KB_RUN_TOKEN_BUDGET_MAX=50000000 hard ceiling of runTokenBudget (env and STAFF setting)
//   KB_RUN_MAX_REQUESTS_PER_STAGE=5000 requests a stage builds at most; the
//                                    remaining subjects are deferred to the next run
//   KB_BATCH_MAX_REQUESTS=5000       requests per DO batch file; a bigger stage
//                                    becomes several batch jobs (DO allows 50k)
//   KB_DIGEST_MAX_MISSING_RATIO=0.2  a subject fails when more than this share of its
//                                    added/changed files has no digest (else they are skipped)
//   KB_RETRY_REJECTED=true           one RETRY round for rejected pages
//   KB_PIPELINE_BACKGROUND=true      poller, minute tick and async advance
//                                    (tests turn it off and drive the engine)
@ConfigurationProperties(prefix = "kb.pipeline")
public record KbPipelineProperties(
    boolean enabled,
    String cron,
    Duration pollInterval,
    String modelDigest,
    String modelPlan,
    String modelWrite,
    String modelRetry,
    Long runTokenBudget,
    Boolean retryRejected,
    Boolean background,
    Long runTokenBudgetMax,
    Integer maxRequestsPerStage,
    Integer batchMaxRequests,
    Double digestMaxMissingRatio,
    java.math.BigDecimal runCostBudgetUsd
) {
    public static final long DEFAULT_TOKEN_BUDGET_MAX = 50_000_000L;
    public static final int DEFAULT_MAX_REQUESTS = 5000;
    public static final java.math.BigDecimal MIN_COST_BUDGET_USD = new java.math.BigDecimal("0.10");
    public static final java.math.BigDecimal MAX_COST_BUDGET_USD = new java.math.BigDecimal("100");
    public static final java.math.BigDecimal DEFAULT_COST_BUDGET_USD = new java.math.BigDecimal("5.00");

    public KbPipelineProperties {
        cron = blank(cron) ? "0 0 3 * * SUN" : cron.trim();
        pollInterval = pollInterval == null || pollInterval.isZero() ? Duration.ofMinutes(10) : pollInterval;
        modelDigest = blank(modelDigest) ? "glm-5.3-flash" : modelDigest.trim();
        modelPlan = blank(modelPlan) ? "glm-5.3" : modelPlan.trim();
        modelWrite = blank(modelWrite) ? "glm-5.3" : modelWrite.trim();
        modelRetry = blank(modelRetry) ? modelWrite : modelRetry.trim();
        runTokenBudgetMax = runTokenBudgetMax == null || runTokenBudgetMax <= 0 ? DEFAULT_TOKEN_BUDGET_MAX : runTokenBudgetMax;
        runTokenBudget = Math.min(runTokenBudgetMax, runTokenBudget == null || runTokenBudget <= 0 ? 3_000_000L : runTokenBudget);
        maxRequestsPerStage = maxRequestsPerStage == null || maxRequestsPerStage <= 0 ? DEFAULT_MAX_REQUESTS : maxRequestsPerStage;
        batchMaxRequests = batchMaxRequests == null || batchMaxRequests <= 0 ? DEFAULT_MAX_REQUESTS : batchMaxRequests;
        digestMaxMissingRatio = digestMaxMissingRatio == null || digestMaxMissingRatio < 0 || digestMaxMissingRatio > 1
            ? 0.2 : digestMaxMissingRatio;
        runCostBudgetUsd = runCostBudgetUsd == null ? DEFAULT_COST_BUDGET_USD
            : runCostBudgetUsd.max(MIN_COST_BUDGET_USD).min(MAX_COST_BUDGET_USD);
        retryRejected = retryRejected == null || retryRejected;
        background = background == null || background;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
