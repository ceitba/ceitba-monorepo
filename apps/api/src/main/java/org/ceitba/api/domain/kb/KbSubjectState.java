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

// The inputs a subject's wiki was last compiled from (V35).
@Entity
@Table(schema = "wiki", name = "kb_subject_state")
public class KbSubjectState {

    @Id
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(name = "inputs_hash", nullable = false, length = 64)
    private String inputsHash;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode inputs;

    @Column(name = "compiled_at", nullable = false)
    private OffsetDateTime compiledAt;

    @Column(name = "last_run_id")
    private UUID lastRunId;

    protected KbSubjectState() {}

    public KbSubjectState(String subjectId) {
        this.subjectId = subjectId;
    }

    public void compiled(String hash, JsonNode inputs, OffsetDateTime at, UUID runId) {
        this.inputsHash = hash;
        this.inputs = inputs;
        this.compiledAt = at;
        this.lastRunId = runId;
    }

    public String getSubjectId() { return subjectId; }
    public String getInputsHash() { return inputsHash; }
    public JsonNode getInputs() { return inputs; }
    public OffsetDateTime getCompiledAt() { return compiledAt; }
    public UUID getLastRunId() { return lastRunId; }
}
