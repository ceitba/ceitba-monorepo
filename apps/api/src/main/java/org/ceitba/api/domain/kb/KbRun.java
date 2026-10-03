package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

// One pipeline run or eval (V33 + V35; trigger SCHEDULED | MANUAL | EVAL).
// status: RUNNING (working), WAITING (a DO batch is out),
// BLOCKED_BY_COST_LIMIT (waits for approve-cost), SUCCEEDED, FAILED,
// CANCELLED. stage: DETECT, DIGEST, PLAN, WRITE, RETRY, PUBLISH|REPORT, DONE.
@Entity
@Table(schema = "wiki", name = "kb_run")
public class KbRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 32)
    private String status;

    @Column(name = "trigger", nullable = false, length = 16)
    private String trigger;

    @Column(length = 16)
    private String stage;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stage_log", columnDefinition = "jsonb", nullable = false)
    private JsonNode stageLog = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();

    @Column(name = "dry_run", nullable = false)
    private boolean dryRun;

    @Column(name = "prompt_version", length = 16)
    private String promptVersion;

    @Column(length = 128)
    private String model;

    @Column(length = 128)
    private String generator;

    // Summary per subject (refreshed as the run moves); details in kb_run_subject.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode subjects;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode stats;

    @Column(name = "tokens_in", nullable = false)
    private long tokensIn;

    @Column(name = "tokens_out", nullable = false)
    private long tokensOut;

    @Column(name = "tokens_cached", nullable = false)
    private long tokensCached;

    @Column(name = "expected_cost_usd", precision = 12, scale = 4)
    private BigDecimal expectedCostUsd;

    @Column(name = "cost_approved", nullable = false)
    private boolean costApproved;

    @Column(nullable = false)
    private boolean simulated;

    @Column(name = "estimated_tokens", nullable = false)
    private long estimatedTokens;

    @Column(name = "cost_estimate", precision = 12, scale = 4)
    private BigDecimal costEstimate;

    @Column(columnDefinition = "text")
    private String error;

    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;

    @Column(name = "finished_at")
    private OffsetDateTime finishedAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected KbRun() {}

    public KbRun(String trigger, boolean dryRun, String promptVersion, String model, OffsetDateTime startedAt,
                 JsonNode empty) {
        this.status = "RUNNING";
        this.stage = "DETECT";
        this.trigger = trigger;
        this.dryRun = dryRun;
        this.promptVersion = promptVersion;
        this.model = model;
        this.startedAt = startedAt;
        this.subjects = empty;
        this.stats = empty;
    }

    public UUID getId() { return id; }
    public String getStatus() { return status; }
    public String getTrigger() { return trigger; }
    public String getStage() { return stage; }
    public boolean isDryRun() { return dryRun; }
    public String getPromptVersion() { return promptVersion; }
    public String getModel() { return model; }
    public JsonNode getSubjects() { return subjects; }
    public JsonNode getStats() { return stats; }
    public long getTokensIn() { return tokensIn; }
    public long getTokensOut() { return tokensOut; }
    public long getEstimatedTokens() { return estimatedTokens; }
    public BigDecimal getCostEstimate() { return costEstimate; }
    public String getError() { return error; }
    public OffsetDateTime getStartedAt() { return startedAt; }
    public OffsetDateTime getFinishedAt() { return finishedAt; }

    public boolean isActive() {
        return status.equals("RUNNING") || status.equals("WAITING") || status.equals("BLOCKED_BY_COST_LIMIT");
    }

    public boolean isEval() { return "EVAL".equals(trigger); }
    public long getTokensCached() { return tokensCached; }
    public boolean isCostApproved() { return costApproved; }
    public BigDecimal getExpectedCostUsd() { return expectedCostUsd; }
    public void setExpectedCostUsd(BigDecimal v) { this.expectedCostUsd = v; }
    public void setCostApproved(boolean approved) { this.costApproved = approved; }
    public boolean isSimulated() { return simulated; }
    public void setSimulated(boolean simulated) { this.simulated = simulated; }
    public void addCached(long cached) { this.tokensCached += cached; }
    public void addCost(BigDecimal cost) {
        this.costEstimate = (this.costEstimate == null ? BigDecimal.ZERO : this.costEstimate).add(cost);
    }

    public void setStatus(String status) { this.status = status; }
    public void setStage(String stage) { this.stage = stage; }
    public void setSubjects(JsonNode subjects) { this.subjects = subjects; }
    public void setStats(JsonNode stats) { this.stats = stats; }
    public void addTokens(long in, long out) { this.tokensIn += in; this.tokensOut += out; }
    public void addEstimated(long tokens) { this.estimatedTokens += tokens; }
    public void setCostEstimate(BigDecimal cost) { this.costEstimate = cost; }
    public void setError(String error) { this.error = error; }
    public void finish(String status, OffsetDateTime at) {
        this.status = status;
        this.finishedAt = at;
    }

    public JsonNode getStageLog() { return stageLog; }
    public void setStageLog(JsonNode stageLog) { this.stageLog = stageLog; }
}
