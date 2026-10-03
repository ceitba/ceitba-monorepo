package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// Every saved version of the runtime settings (audit + restore).
@Entity
@Table(schema = "wiki", name = "kb_pipeline_settings_history")
public class KbPipelineSettingsHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode settings;

    @Column(name = "changed_by")
    private UUID changedBy;

    @Column(name = "changed_at", nullable = false)
    private OffsetDateTime changedAt;

    @Column(columnDefinition = "text")
    private String note;

    protected KbPipelineSettingsHistory() {}

    public KbPipelineSettingsHistory(JsonNode settings, UUID changedBy, OffsetDateTime changedAt, String note) {
        this.settings = settings;
        this.changedBy = changedBy;
        this.changedAt = changedAt;
        this.note = note;
    }

    public UUID getId() { return id; }
    public JsonNode getSettings() { return settings; }
    public UUID getChangedBy() { return changedBy; }
    public OffsetDateTime getChangedAt() { return changedAt; }
    public String getNote() { return note; }
}
