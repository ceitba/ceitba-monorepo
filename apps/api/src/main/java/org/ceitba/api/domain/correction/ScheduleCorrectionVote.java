package org.ceitba.api.domain.correction;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// One vote per (correction, user); changing it updates `type` in place.
@Entity
@Table(schema = "public", name = "schedule_correction_vote")
@IdClass(ScheduleCorrectionVoteId.class)
public class ScheduleCorrectionVote {

    @Id
    @Column(name = "correction_id", nullable = false)
    private UUID correctionId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private ScheduleCorrectionVoteType type;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected ScheduleCorrectionVote() {}

    public ScheduleCorrectionVote(UUID correctionId, UUID userId, ScheduleCorrectionVoteType type) {
        this.correctionId = correctionId;
        this.userId = userId;
        this.type = type;
    }

    public UUID getCorrectionId() { return correctionId; }
    public UUID getUserId() { return userId; }
    public ScheduleCorrectionVoteType getType() { return type; }

    public void setType(ScheduleCorrectionVoteType type) { this.type = type; }
}
