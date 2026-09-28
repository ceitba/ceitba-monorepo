package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// Membership row (V24). The owner is a participant too. joined_at is set by
// the service from the injected Clock; it orders the participant list and
// picks the next owner when the owner leaves.
@Entity
@Table(schema = "public", name = "study_group_participants")
@IdClass(StudyGroupParticipantId.class)
public class StudyGroupParticipant {

    @Id
    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "joined_at", nullable = false, updatable = false)
    private OffsetDateTime joinedAt;

    protected StudyGroupParticipant() {}

    public StudyGroupParticipant(UUID groupId, UUID userId, OffsetDateTime joinedAt) {
        this.groupId = groupId;
        this.userId = userId;
        this.joinedAt = joinedAt;
    }

    public UUID getGroupId() { return groupId; }
    public UUID getUserId() { return userId; }
    public OffsetDateTime getJoinedAt() { return joinedAt; }
}
