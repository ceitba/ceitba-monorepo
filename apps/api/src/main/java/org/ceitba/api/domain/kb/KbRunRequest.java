package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// One LLM request of a run (V35). status: PENDING (built), SUBMITTED, DONE,
// FAILED (no usable answer after the resubmission), DEFERRED (over budget).
@Entity
@Table(schema = "wiki", name = "kb_run_request")
public class KbRunRequest {

    @Id
    @Column(name = "custom_id", length = 64)
    private String customId;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "batch_job_id")
    private UUID batchJobId;

    @Column(nullable = false, length = 16)
    private String stage;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Column(name = "item_key", nullable = false, columnDefinition = "text")
    private String itemKey;

    @Column(nullable = false, length = 128)
    private String target;

    @Column(nullable = false)
    private int chunk;

    @Column(nullable = false, length = 128)
    private String model;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode params;

    @Column(name = "est_tokens", nullable = false)
    private int estTokens;

    @Column(nullable = false, length = 16)
    private String status = "PENDING";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode result;

    @Column(columnDefinition = "text")
    private String error;

    @Column(name = "tokens_in", nullable = false)
    private int tokensIn;

    @Column(name = "tokens_out", nullable = false)
    private int tokensOut;

    @Column(name = "tokens_cached", nullable = false)
    private int tokensCached;

    @Column(name = "exec_path", length = 32)
    private String execPath;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @Column(name = "latency_ms")
    private Integer latencyMs;

    // DIGEST: fingerprint of the content actually sent (V41); the digest is
    // stored under it even if the file changed after DETECT.
    @Column(name = "content_fingerprint", length = 64)
    private String contentFingerprint;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected KbRunRequest() {}

    public KbRunRequest(String customId, UUID runId, String stage, String subjectId, String itemKey, String target,
                        int chunk, String model, JsonNode params, int estTokens) {
        this.customId = customId;
        this.runId = runId;
        this.stage = stage;
        this.subjectId = subjectId;
        this.itemKey = itemKey;
        this.target = target;
        this.chunk = chunk;
        this.model = model;
        this.params = params;
        this.estTokens = estTokens;
    }

    public String getCustomId() { return customId; }
    public UUID getRunId() { return runId; }
    public UUID getBatchJobId() { return batchJobId; }
    public String getStage() { return stage; }
    public String getSubjectId() { return subjectId; }
    public String getItemKey() { return itemKey; }
    public String getTarget() { return target; }
    public int getChunk() { return chunk; }
    public String getModel() { return model; }
    public JsonNode getParams() { return params; }
    public int getEstTokens() { return estTokens; }
    public String getStatus() { return status; }
    public JsonNode getResult() { return result; }
    public String getError() { return error; }
    public int getTokensIn() { return tokensIn; }
    public int getTokensOut() { return tokensOut; }

    // Sent (again): a resubmission clears the previous attempt's answer
    // time, so the sync executor picks it up.
    public void submitted(UUID batchJobId) {
        this.batchJobId = batchJobId;
        this.status = "SUBMITTED";
        this.completedAt = null;
        this.latencyMs = null;
    }

    public void done(JsonNode result, int in, int out, int cached, String execPath) {
        this.status = "DONE";
        this.result = result;
        this.error = null;
        this.tokensIn += in;
        this.tokensOut += out;
        this.tokensCached += cached;
        this.execPath = execPath;
    }

    public int getTokensCached() { return tokensCached; }
    public String getExecPath() { return execPath; }

    public void failed(String error) {
        this.status = "FAILED";
        this.error = error;
    }

    public void setStatus(String status) { this.status = status; }

    // For the resubmission of an empty/truncated answer (batch mode).
    public void doubleMaxTokens(int cap) {
        if (params instanceof com.fasterxml.jackson.databind.node.ObjectNode o) {
            var copy = o.deepCopy();
            copy.put("max_tokens", Math.min(cap, o.path("max_tokens").asInt(4096) * 2));
            this.params = copy;
        }
    }
    public void setError(String error) { this.error = error; }

    // An answer arrived (ok or not): when, and how long the request took (sync).
    public void answered(OffsetDateTime at, Integer latencyMs) {
        this.completedAt = at;
        this.latencyMs = latencyMs;
    }

    public OffsetDateTime getCompletedAt() { return completedAt; }
    public String getContentFingerprint() { return contentFingerprint; }
    public void setContentFingerprint(String fingerprint) { this.contentFingerprint = fingerprint; }
    public Integer getLatencyMs() { return latencyMs; }
}
