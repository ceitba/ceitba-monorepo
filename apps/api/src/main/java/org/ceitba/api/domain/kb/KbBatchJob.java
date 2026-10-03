package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// One DO batch of a run stage (V35). status: DRY (built, not submitted),
// SUBMITTED, COMPLETED, FAILED, CANCELLED.
@Entity
@Table(schema = "wiki", name = "kb_batch_job")
public class KbBatchJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(nullable = false, length = 16)
    private String stage;

    @Column(nullable = false)
    private int attempt;

    @Column(nullable = false, length = 128)
    private String model;

    // BATCH (a DO batch) or SYNC (chat completions one by one).
    @Column(nullable = false, length = 8)
    private String mode = "BATCH";

    @Column(name = "tokens_cached", nullable = false)
    private long tokensCached;

    @Column(name = "cost_estimate", precision = 12, scale = 4)
    private java.math.BigDecimal costEstimate;

    @Column(name = "do_batch_id", length = 128)
    private String doBatchId;

    @Column(name = "do_file_id", length = 128)
    private String doFileId;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "request_count", nullable = false)
    private int requestCount;

    @Column(name = "payload_key", columnDefinition = "text")
    private String payloadKey;

    @Column(name = "output_key", columnDefinition = "text")
    private String outputKey;

    @Column(name = "tokens_in", nullable = false)
    private long tokensIn;

    @Column(name = "tokens_out", nullable = false)
    private long tokensOut;

    @Column(name = "submitted_at")
    private OffsetDateTime submittedAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @Column(name = "output_file_url_fetched_at")
    private OffsetDateTime outputFetchedAt;

    @Column(columnDefinition = "text")
    private String error;

    @Column(name = "do_status", length = 32)
    private String doStatus;

    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    @Column(name = "do_request_counts", columnDefinition = "jsonb")
    private com.fasterxml.jackson.databind.JsonNode doRequestCounts;

    @Column(name = "status_changed_at")
    private OffsetDateTime statusChangedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected KbBatchJob() {}

    public KbBatchJob(UUID runId, String stage, int attempt, String model, String mode, int requestCount,
                      String payloadKey) {
        this.mode = mode;
        this.runId = runId;
        this.stage = stage;
        this.attempt = attempt;
        this.model = model;
        this.requestCount = requestCount;
        this.payloadKey = payloadKey;
        this.status = "DRY";
    }

    public UUID getId() { return id; }
    public UUID getRunId() { return runId; }
    public String getStage() { return stage; }
    public int getAttempt() { return attempt; }
    public String getModel() { return model; }
    public String getDoBatchId() { return doBatchId; }
    public String getDoFileId() { return doFileId; }
    public String getStatus() { return status; }
    public int getRequestCount() { return requestCount; }
    public String getPayloadKey() { return payloadKey; }
    public String getOutputKey() { return outputKey; }
    public long getTokensIn() { return tokensIn; }
    public long getTokensOut() { return tokensOut; }
    public OffsetDateTime getSubmittedAt() { return submittedAt; }
    public OffsetDateTime getCompletedAt() { return completedAt; }
    public String getError() { return error; }
    public String getMode() { return mode; }
    public long getTokensCached() { return tokensCached; }
    public java.math.BigDecimal getCostEstimate() { return costEstimate; }
    public void addUsage(long in, long out, long cached, java.math.BigDecimal cost) {
        this.tokensIn += in;
        this.tokensOut += out;
        this.tokensCached += cached;
        this.costEstimate = (costEstimate == null ? java.math.BigDecimal.ZERO : costEstimate).add(cost);
    }
    public void finish(String status, String outputKey, OffsetDateTime at, String error) {
        this.status = status;
        this.outputKey = outputKey;
        this.completedAt = at;
        this.outputFetchedAt = at;
        this.error = error;
    }
    public OffsetDateTime getCreatedAt() { return createdAt; }

    public void submitted(String fileId, String batchId, OffsetDateTime at) {
        this.doFileId = fileId;
        this.doBatchId = batchId;
        this.submittedAt = at;
        this.status = "SUBMITTED";
    }

    public void completed(String status, String outputKey, long in, long out, OffsetDateTime at, String error) {
        this.status = status;
        this.outputKey = outputKey;
        this.tokensIn = in;
        this.tokensOut = out;
        this.completedAt = at;
        this.outputFetchedAt = at;
        this.error = error;
    }

    public void setStatus(String status) { this.status = status; }
    public void setError(String error) { this.error = error; }

    // DO's view of the batch (GET /v1/batches/{id}): status and request_counts.
    public void observed(String doStatus, com.fasterxml.jackson.databind.JsonNode requestCounts, OffsetDateTime at) {
        if (doStatus != null && !doStatus.equals(this.doStatus)) this.statusChangedAt = at;
        this.doStatus = doStatus;
        if (requestCounts != null && !requestCounts.isMissingNode() && !requestCounts.isNull()) {
            this.doRequestCounts = requestCounts;
        }
    }

    public String getDoStatus() { return doStatus; }
    public com.fasterxml.jackson.databind.JsonNode getDoRequestCounts() { return doRequestCounts; }
    public OffsetDateTime getStatusChangedAt() { return statusChangedAt; }
}
