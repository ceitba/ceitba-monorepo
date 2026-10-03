package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// The single row of runtime settings overriding env defaults (V35).
@Entity
@Table(schema = "wiki", name = "kb_pipeline_settings")
public class KbPipelineSettingsRow {

    public static final int ID = 1;

    @Id
    private Integer id = ID;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode settings;

    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected KbPipelineSettingsRow() {}

    public KbPipelineSettingsRow(JsonNode settings, UUID by, OffsetDateTime at) {
        update(settings, by, at);
    }

    public void update(JsonNode settings, UUID by, OffsetDateTime at) {
        this.settings = settings;
        this.updatedBy = by;
        this.updatedAt = at;
    }

    public JsonNode getSettings() { return settings; }
    public UUID getUpdatedBy() { return updatedBy; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
