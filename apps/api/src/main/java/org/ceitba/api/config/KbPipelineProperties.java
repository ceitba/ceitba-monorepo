package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// Env defaults of the subject wiki pipeline (docs/SUBJECT-WIKI-PIPELINE.md),
// bound from kb.pipeline.*. STAFF can override most of them at runtime
// (kb_pipeline_settings, docs/SUBJECT-WIKI-ADMIN.md):
//   KB_PIPELINE_ENABLED=false        weekly scheduled run (manual runs always work)
//   KB_PIPELINE_CRON="0 0 3 * * SUN" Spring cron, America/Argentina/Buenos_Aires
//   KB_POLL_INTERVAL=PT10M           how often active runs are advanced
//   KB_MODEL_DIGEST=glm-5.3-flash, KB_MODEL_PLAN=glm-5.3, KB_MODEL_WRITE=glm-5.3,
//   KB_MODEL_RETRY=(write model)
//   KB_RUN_TOKEN_BUDGET=3000000      estimated input tokens per run
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
    Boolean background
) {
    public KbPipelineProperties {
        cron = blank(cron) ? "0 0 3 * * SUN" : cron.trim();
        pollInterval = pollInterval == null || pollInterval.isZero() ? Duration.ofMinutes(10) : pollInterval;
        modelDigest = blank(modelDigest) ? "glm-5.3-flash" : modelDigest.trim();
        modelPlan = blank(modelPlan) ? "glm-5.3" : modelPlan.trim();
        modelWrite = blank(modelWrite) ? "glm-5.3" : modelWrite.trim();
        modelRetry = blank(modelRetry) ? modelWrite : modelRetry.trim();
        runTokenBudget = runTokenBudget == null || runTokenBudget <= 0 ? 3_000_000L : runTokenBudget;
        retryRejected = retryRejected == null || retryRejected;
        background = background == null || background;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
