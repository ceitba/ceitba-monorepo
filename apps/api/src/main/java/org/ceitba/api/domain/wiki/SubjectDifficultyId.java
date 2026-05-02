package org.ceitba.api.domain.wiki;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class SubjectDifficultyId implements Serializable {

    private String subjectId;
    private UUID userId;

    public SubjectDifficultyId() {}

    public SubjectDifficultyId(String subjectId, UUID userId) {
        this.subjectId = subjectId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof SubjectDifficultyId other)) return false;
        return Objects.equals(subjectId, other.subjectId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(subjectId, userId);
    }
}
