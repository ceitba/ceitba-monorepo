package org.ceitba.api.domain.kb;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// @IdClass of KbRunSubject (pattern: domain/PlanSubject.java).
public class KbRunSubjectId implements Serializable {

    private UUID runId;
    private String subjectId;

    public KbRunSubjectId() {}

    public KbRunSubjectId(UUID runId, String subjectId) {
        this.runId = runId;
        this.subjectId = subjectId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof KbRunSubjectId other
            && Objects.equals(runId, other.runId) && Objects.equals(subjectId, other.subjectId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(runId, subjectId);
    }
}
