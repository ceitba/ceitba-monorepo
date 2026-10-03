package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// A benchmark set (V35, ADMIN doc §4). frozenInputs:
// {subjectId: [{fileId, fingerprint, name, academicYear, digestId, textKey}]}.
@Entity
@Table(schema = "wiki", name = "kb_eval_set")
public class KbEvalSet {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, columnDefinition = "text")
    private String name;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "subject_ids", columnDefinition = "jsonb", nullable = false)
    private JsonNode subjectIds;

    @Column(name = "created_by")
    private UUID createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "frozen_inputs", columnDefinition = "jsonb")
    private JsonNode frozenInputs;

    @Column(name = "frozen_at")
    private OffsetDateTime frozenAt;

    protected KbEvalSet() {}

    public KbEvalSet(String name, JsonNode subjectIds, UUID createdBy) {
        this.name = name;
        this.subjectIds = subjectIds;
        this.createdBy = createdBy;
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public JsonNode getSubjectIds() { return subjectIds; }
    public UUID getCreatedBy() { return createdBy; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public JsonNode getFrozenInputs() { return frozenInputs; }
    public OffsetDateTime getFrozenAt() { return frozenAt; }

    public void freeze(JsonNode inputs, OffsetDateTime at) {
        this.frozenInputs = inputs;
        this.frozenAt = at;
    }
}
