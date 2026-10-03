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

// An evaluation (V35). Its id is the id of the kb_run (trigger EVAL) that
// executes it. configs: [{key, plan, write}]. results:
// {configKey: {subjectId: {operations, pages: {slug: {...}}, metrics}}, totals}.
@Entity
@Table(schema = "wiki", name = "kb_eval")
public class KbEval {

    @Id
    private UUID id;

    @Column(name = "set_id", nullable = false)
    private UUID setId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode configs;

    @Column(columnDefinition = "text")
    private String note;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode results;

    @Column(name = "created_by")
    private UUID createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "finished_at")
    private OffsetDateTime finishedAt;

    protected KbEval() {}

    public KbEval(UUID id, UUID setId, JsonNode configs, String note, JsonNode results, UUID createdBy) {
        this.id = id;
        this.setId = setId;
        this.configs = configs;
        this.note = note;
        this.results = results;
        this.createdBy = createdBy;
    }

    public UUID getId() { return id; }
    public UUID getSetId() { return setId; }
    public JsonNode getConfigs() { return configs; }
    public String getNote() { return note; }
    public JsonNode getResults() { return results; }
    public UUID getCreatedBy() { return createdBy; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getFinishedAt() { return finishedAt; }

    public void setResults(JsonNode results) { this.results = results; }
    public void finish(OffsetDateTime at) { this.finishedAt = at; }
}
