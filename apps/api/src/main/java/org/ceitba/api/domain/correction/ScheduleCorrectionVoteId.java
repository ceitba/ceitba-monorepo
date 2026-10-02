package org.ceitba.api.domain.correction;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class ScheduleCorrectionVoteId implements Serializable {

    private UUID correctionId;
    private UUID userId;

    public ScheduleCorrectionVoteId() {}

    public ScheduleCorrectionVoteId(UUID correctionId, UUID userId) {
        this.correctionId = correctionId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ScheduleCorrectionVoteId other)) return false;
        return Objects.equals(correctionId, other.correctionId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(correctionId, userId);
    }
}
