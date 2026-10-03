package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

// One LLM request result with its frozen cost (V35, ADMIN doc §3).
@Entity
@Table(schema = "wiki", name = "kb_llm_usage")
public class KbLlmUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "run_id")
    private UUID runId;

    @Column(name = "eval_id")
    private UUID evalId;

    @Column(name = "request_id", length = 64)
    private String requestId;

    @Column(nullable = false, length = 128)
    private String model;

    @Column(nullable = false, length = 8)
    private String mode;

    @Column(nullable = false, length = 16)
    private String stage;

    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(name = "input_tokens", nullable = false)
    private int inputTokens;

    @Column(name = "cached_input_tokens", nullable = false)
    private int cachedInputTokens;

    @Column(name = "output_tokens", nullable = false)
    private int outputTokens;

    @Column(name = "cost_usd", nullable = false, precision = 14, scale = 6)
    private BigDecimal costUsd;

    @Column(nullable = false)
    private boolean simulated;

    protected KbLlmUsage() {}

    public KbLlmUsage(OffsetDateTime createdAt, UUID runId, UUID evalId, String requestId, String model, String mode,
                      String stage, String subjectId, int inputTokens, int cachedInputTokens, int outputTokens,
                      BigDecimal costUsd, boolean simulated) {
        this.createdAt = createdAt;
        this.runId = runId;
        this.evalId = evalId;
        this.requestId = requestId;
        this.model = model;
        this.mode = mode;
        this.stage = stage;
        this.subjectId = subjectId;
        this.inputTokens = inputTokens;
        this.cachedInputTokens = cachedInputTokens;
        this.outputTokens = outputTokens;
        this.costUsd = costUsd;
        this.simulated = simulated;
    }

    public UUID getRunId() { return runId; }
    public UUID getEvalId() { return evalId; }
    public String getRequestIdOrNull() { return requestId; }
    public OffsetDateTime getCreatedAtOrNull() { return createdAt; }
    public boolean isSimulated() { return simulated; }
    public String getModel() { return model; }
    public String getMode() { return mode; }
    public String getStage() { return stage; }
    public String getSubjectId() { return subjectId; }
    public int getInputTokens() { return inputTokens; }
    public int getCachedInputTokens() { return cachedInputTokens; }
    public int getOutputTokens() { return outputTokens; }
    public BigDecimal getCostUsd() { return costUsd; }
}
