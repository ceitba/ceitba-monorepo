package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One change of a catalog field (V36): source do-catalog | manual.
@Entity
@Table(name = "kb_model_price_history", schema = "wiki")
public class KbModelPriceHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "model_id", nullable = false, length = 128)
    private String modelId;

    @Column(nullable = false, length = 32)
    private String field;

    @Column(name = "old_value")
    private String oldValue;

    @Column(name = "new_value")
    private String newValue;

    @Column(name = "changed_at", nullable = false)
    private OffsetDateTime changedAt;

    @Column(nullable = false, length = 32)
    private String source;

    protected KbModelPriceHistory() {}

    public KbModelPriceHistory(String modelId, String field, String oldValue, String newValue, OffsetDateTime changedAt,
                               String source) {
        this.modelId = modelId;
        this.field = field;
        this.oldValue = oldValue;
        this.newValue = newValue;
        this.changedAt = changedAt;
        this.source = source;
    }

    public UUID getId() { return id; }
    public String getModelId() { return modelId; }
    public String getField() { return field; }
    public String getOldValue() { return oldValue; }
    public String getNewValue() { return newValue; }
    public OffsetDateTime getChangedAt() { return changedAt; }
    public String getSource() { return source; }
}
