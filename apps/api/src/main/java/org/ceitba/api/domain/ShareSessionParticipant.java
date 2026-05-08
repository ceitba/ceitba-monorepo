package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// One row per (session, user) join. saved_schedule_id is nullable on purpose:
// if the user later deletes the saved_schedule we cleared the FK (ON DELETE
// SET NULL) so the rest of the session still loads.
@Entity
@Table(schema = "public", name = "share_session_participants")
@IdClass(ShareSessionParticipantId.class)
public class ShareSessionParticipant {

    @Id
    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "saved_schedule_id")
    private UUID savedScheduleId;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    @CreationTimestamp
    @Column(name = "joined_at", nullable = false, updatable = false)
    private OffsetDateTime joinedAt;

    protected ShareSessionParticipant() {}

    public ShareSessionParticipant(UUID sessionId, UUID userId, UUID savedScheduleId, String displayName) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.savedScheduleId = savedScheduleId;
        this.displayName = displayName;
    }

    public UUID getSessionId() { return sessionId; }
    public UUID getUserId() { return userId; }
    public UUID getSavedScheduleId() { return savedScheduleId; }
    public String getDisplayName() { return displayName; }
    public OffsetDateTime getJoinedAt() { return joinedAt; }

    public void setSavedScheduleId(UUID savedScheduleId) { this.savedScheduleId = savedScheduleId; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
}
