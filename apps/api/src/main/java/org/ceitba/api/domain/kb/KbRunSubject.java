package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.UUID;

// A dirty subject inside a run (V35). status: PENDING, DEFERRED (over
// budget), FAILED (an LLM stage failed: stays dirty), PUBLISHED, DRY,
// CANCELLED. The jsonb columns are written by KbPipelineService.
@Entity
@IdClass(KbRunSubjectId.class)
@Table(schema = "wiki", name = "kb_run_subject")
public class KbRunSubject {

    @Id
    @Column(name = "run_id")
    private UUID runId;

    @Id
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(nullable = false, length = 16)
    private String status = "PENDING";

    @Column(nullable = false, length = 128)
    private String model;

    @Column(nullable = false)
    private long priority;

    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode inputs;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode added;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode changed;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode removed;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode operations;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode drafts;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode accepted;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode rejected;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) private JsonNode deleted;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode skipped = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();

    @Column(name = "tokens_in", nullable = false)
    private long tokensIn;

    @Column(name = "tokens_out", nullable = false)
    private long tokensOut;

    @Column(name = "tokens_cached", nullable = false)
    private long tokensCached;

    @Column(name = "cost_estimate", nullable = false, precision = 12, scale = 4)
    private java.math.BigDecimal costEstimate = java.math.BigDecimal.ZERO;

    @Column(columnDefinition = "text")
    private String error;

    protected KbRunSubject() {}

    public KbRunSubject(UUID runId, String subjectId, String model, long priority, JsonNode inputs, JsonNode added,
                        JsonNode changed, JsonNode removed, JsonNode emptyArray, JsonNode emptyObject) {
        this.runId = runId;
        this.subjectId = subjectId;
        this.model = model;
        this.priority = priority;
        this.inputs = inputs;
        this.added = added;
        this.changed = changed;
        this.removed = removed;
        this.operations = emptyArray;
        this.drafts = emptyObject;
        this.accepted = emptyArray;
        this.rejected = emptyArray;
        this.deleted = emptyArray;
    }

    public UUID getRunId() { return runId; }
    public String getSubjectId() { return subjectId; }
    public String getStatus() { return status; }
    public String getModel() { return model; }
    public long getPriority() { return priority; }
    public JsonNode getInputs() { return inputs; }
    public JsonNode getAdded() { return added; }
    public JsonNode getChanged() { return changed; }
    public JsonNode getRemoved() { return removed; }
    public JsonNode getOperations() { return operations; }
    public JsonNode getDrafts() { return drafts; }
    public JsonNode getAccepted() { return accepted; }
    public JsonNode getRejected() { return rejected; }
    public JsonNode getDeleted() { return deleted; }
    public long getTokensIn() { return tokensIn; }
    public long getTokensOut() { return tokensOut; }
    public String getError() { return error; }

    public boolean isActive() { return status.equals("PENDING"); }

    public void setStatus(String status) { this.status = status; }
    public void fail(String error) {
        this.status = "FAILED";
        this.error = error;
    }
    public void setError(String error) { this.error = error; }
    public JsonNode getSkipped() { return skipped; }
    // Files without a digest, dropped from this run's inputs (they stay pending).
    public void skip(JsonNode skipped, JsonNode inputs, JsonNode added, JsonNode changed) {
        this.skipped = skipped;
        this.inputs = inputs;
        this.added = added;
        this.changed = changed;
    }
    public void setOperations(JsonNode operations) { this.operations = operations; }
    public void setDrafts(JsonNode drafts) { this.drafts = drafts; }
    public void setOutcome(JsonNode accepted, JsonNode rejected, JsonNode deleted) {
        this.accepted = accepted;
        this.rejected = rejected;
        this.deleted = deleted;
    }
    public void addUsage(long in, long out, long cached, java.math.BigDecimal cost) {
        this.tokensIn += in;
        this.tokensOut += out;
        this.tokensCached += cached;
        this.costEstimate = costEstimate.add(cost);
    }
    public long getTokensCached() { return tokensCached; }
    public java.math.BigDecimal getCostEstimate() { return costEstimate; }
}
