package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

// A model of the catalog (V35, docs/SUBJECT-WIKI-ADMIN.md §2). Prices are
// USD per million tokens; null price = unknown (cost recorded as 0).
@Entity
@Table(schema = "wiki", name = "kb_model")
public class KbModel {

    @Id
    @Column(length = 128)
    private String id;

    @Column(name = "display_name", nullable = false, length = 128)
    private String displayName;

    @Column(nullable = false, length = 32)
    private String provider;

    @Column(name = "batch_supported", nullable = false)
    private boolean batchSupported;

    @Column(name = "batch_source", nullable = false, length = 8)
    private String batchSource = "rule";

    @Column(name = "batch_verified_at")
    private OffsetDateTime batchVerifiedAt;

    @Column(name = "batch_discount_verified", nullable = false)
    private boolean batchDiscountVerified;

    @Column(name = "tool_calling", nullable = false, length = 8)
    private String toolCalling = "unknown";

    @Column(name = "supports_reasoning_effort", nullable = false)
    private boolean supportsReasoningEffort;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "input_per_m", precision = 10, scale = 4)
    private BigDecimal inputPerM;

    @Column(name = "output_per_m", precision = 10, scale = 4)
    private BigDecimal outputPerM;

    @Column(name = "cache_read_per_m", precision = 10, scale = 4)
    private BigDecimal cacheReadPerM;

    @Column(name = "batch_discount", nullable = false, precision = 4, scale = 3)
    private BigDecimal batchDiscount = new BigDecimal("0.5");

    @Column(name = "context_window")
    private Integer contextWindow;

    @Column(columnDefinition = "text")
    private String notes;

    @Column(name = "prices_updated_at")
    private OffsetDateTime pricesUpdatedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "last_probe", columnDefinition = "jsonb")
    private JsonNode lastProbe;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "max_output_tokens")
    private Integer maxOutputTokens;

    @Column(name = "price_source", length = 32)
    private String priceSource;

    @Column(name = "display_name_manual", nullable = false)
    private boolean displayNameManual;

    // The id batch JSONL lines use (V38); null = the catalog id without its
    // openai-/anthropic- prefix (KbChatPayloads.defaultBatchModelId).
    @Column(name = "batch_model_id", length = 128)
    private String batchModelId;

    protected KbModel() {}

    public KbModel(String id, String displayName, String provider, boolean batchSupported, boolean enabled) {
        this.id = id;
        this.displayName = displayName;
        this.provider = provider;
        this.batchSupported = batchSupported;
        this.enabled = enabled;
    }

    // Any successful probe (either mode).
    public boolean probeSucceeded() {
        return probeOk("sync") || probeOk("batch");
    }

    // The mode a stage would run this model in (BATCH | SYNC) for an
    // execution mode (auto | batch | sync); same rule as KbLlmRouter.
    public String modeFor(String executionMode) {
        boolean batch = batchSupported && (id.startsWith("anthropic-") || id.startsWith("openai-"));
        var m = executionMode == null ? "auto" : executionMode.toLowerCase(java.util.Locale.ROOT);
        return m.equals("sync") || !batch ? "SYNC" : "BATCH";
    }

    // The last probe in a mode (lastProbe.sync / lastProbe.batch; entries
    // stored before per-mode probes count for their own mode).
    public JsonNode probeIn(String mode) {
        if (lastProbe == null) return null;
        var key = mode.toLowerCase(java.util.Locale.ROOT);
        if (lastProbe.has(key) && lastProbe.get(key).isObject()) return lastProbe.get(key);
        boolean perMode = lastProbe.has("sync") || lastProbe.has("batch");
        return !perMode && key.equals(lastProbe.path("mode").asText("")) ? lastProbe : null;
    }

    public boolean probeOk(String mode) {
        var p = probeIn(mode);
        return p != null && p.path("ok").asBoolean(false);
    }

    // Selectable for a stage running in `mode`: a successful probe in that
    // mode; a pending (or missing) batch probe falls back to the sync probe,
    // so it never blocks selection.
    public boolean selectableIn(String mode) {
        if (!enabled) return false;
        if (!mode.equalsIgnoreCase("BATCH")) return probeOk("sync");
        if (probeOk("batch")) return true;
        var batch = probeIn("batch");
        boolean pendingOrNone = batch == null || batch.path("pending").asBoolean(false);
        return pendingOrNone && probeOk("sync");
    }

    public String getId() { return id; }
    public String getDisplayName() { return displayName; }
    public String getProvider() { return provider; }
    public boolean isBatchSupported() { return batchSupported; }
    public String getToolCalling() { return toolCalling; }
    public boolean isEnabled() { return enabled; }
    public boolean isSupportsReasoningEffort() { return supportsReasoningEffort; }
    public String getBatchSource() { return batchSource; }
    public OffsetDateTime getBatchVerifiedAt() { return batchVerifiedAt; }
    public boolean isBatchDiscountVerified() { return batchDiscountVerified; }
    public void setBatchDiscountVerified(boolean v) { this.batchDiscountVerified = v; }
    // A batch probe decided it (overrides the rule).
    public void setBatchFromProbe(boolean supported, OffsetDateTime at) {
        this.batchSupported = supported;
        this.batchSource = "probe";
        this.batchVerifiedAt = at;
    }
    public void setSupportsReasoningEffort(boolean v) { this.supportsReasoningEffort = v; }
    public BigDecimal getInputPerM() { return inputPerM; }
    public BigDecimal getOutputPerM() { return outputPerM; }
    public BigDecimal getCacheReadPerM() { return cacheReadPerM; }
    public BigDecimal getBatchDiscount() { return batchDiscount; }
    public Integer getContextWindow() { return contextWindow; }
    public String getNotes() { return notes; }
    public OffsetDateTime getPricesUpdatedAt() { return pricesUpdatedAt; }
    public JsonNode getLastProbe() { return lastProbe; }

    public void setDisplayName(String v) { this.displayName = v; }
    public void setProvider(String v) { this.provider = v; }
    // Set by staff: clears a previous probe verdict.
    public void setBatchSupported(boolean v) {
        this.batchSupported = v;
        this.batchSource = "rule";
        this.batchVerifiedAt = null;
    }
    public void setToolCalling(String v) { this.toolCalling = v; }
    public void setEnabled(boolean v) { this.enabled = v; }
    public void setPrices(BigDecimal input, BigDecimal output, BigDecimal cacheRead, BigDecimal batchDiscount,
                          OffsetDateTime at) {
        this.inputPerM = input;
        this.outputPerM = output;
        this.cacheReadPerM = cacheRead;
        this.batchDiscount = batchDiscount == null ? new BigDecimal("0.5") : batchDiscount;
        this.pricesUpdatedAt = at;
    }
    public void setContextWindow(Integer v) { this.contextWindow = v; }
    public void setNotes(String v) { this.notes = v; }
    public void setLastProbe(JsonNode v) { this.lastProbe = v; }

    public Integer getMaxOutputTokens() { return maxOutputTokens; }
    public void setMaxOutputTokens(Integer v) { this.maxOutputTokens = v; }
    public String getPriceSource() { return priceSource; }
    public void setPriceSource(String v) { this.priceSource = v; }
    public boolean isDisplayNameManual() { return displayNameManual; }
    public void setDisplayNameManual(boolean v) { this.displayNameManual = v; }
    public String getBatchModelId() { return batchModelId; }
    public void setBatchModelId(String v) { this.batchModelId = v == null || v.isBlank() ? null : v.trim(); }
}
