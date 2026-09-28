package org.ceitba.api.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// Composite key (group_id, user_id). Pattern matches PlanSubject.
public class StudyGroupParticipantId implements Serializable {

    private UUID groupId;
    private UUID userId;

    public StudyGroupParticipantId() {}

    public StudyGroupParticipantId(UUID groupId, UUID userId) {
        this.groupId = groupId;
        this.userId = userId;
    }

    public UUID getGroupId() { return groupId; }
    public UUID getUserId() { return userId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof StudyGroupParticipantId other)) return false;
        return Objects.equals(groupId, other.groupId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(groupId, userId);
    }
}
