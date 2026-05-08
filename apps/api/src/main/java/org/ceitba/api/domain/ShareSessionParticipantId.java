package org.ceitba.api.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// Composite key (session_id, user_id). Pattern matches PlanSubject.
public class ShareSessionParticipantId implements Serializable {

    private UUID sessionId;
    private UUID userId;

    public ShareSessionParticipantId() {}

    public ShareSessionParticipantId(UUID sessionId, UUID userId) {
        this.sessionId = sessionId;
        this.userId = userId;
    }

    public UUID getSessionId() { return sessionId; }
    public UUID getUserId() { return userId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ShareSessionParticipantId other)) return false;
        return Objects.equals(sessionId, other.sessionId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sessionId, userId);
    }
}
