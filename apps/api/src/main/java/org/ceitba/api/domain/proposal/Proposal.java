package org.ceitba.api.domain.proposal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.ceitba.api.domain.ProposalStatus;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A student proposal ("Propuesta"). author_id is null once the author's
// account is deleted. Counters are denormalized and only changed by
// ProposalService while it holds a row lock on the proposal.
@Entity
@Table(schema = "public", name = "proposal")
public class Proposal {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "author_id")
    private UUID authorId;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ProposalTopic topic;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ProposalStatus status = ProposalStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ProposalLifecycle lifecycle = ProposalLifecycle.ABIERTO;

    @Column(name = "rejection_reason", length = 1024)
    private String rejectionReason;

    @Column(name = "moderated_by")
    private UUID moderatedBy;

    @Column(name = "moderated_at")
    private OffsetDateTime moderatedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "up_count", nullable = false)
    private int upCount;

    @Column(name = "down_count", nullable = false)
    private int downCount;

    @Column(name = "comment_count", nullable = false)
    private int commentCount;

    protected Proposal() {}

    public Proposal(UUID authorId, String title, String description, ProposalTopic topic) {
        this.authorId = authorId;
        this.title = title;
        this.description = description;
        this.topic = topic;
    }

    public UUID getId() { return id; }
    public UUID getAuthorId() { return authorId; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public ProposalTopic getTopic() { return topic; }
    public ProposalStatus getStatus() { return status; }
    public ProposalLifecycle getLifecycle() { return lifecycle; }
    public String getRejectionReason() { return rejectionReason; }
    public UUID getModeratedBy() { return moderatedBy; }
    public OffsetDateTime getModeratedAt() { return moderatedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public int getUpCount() { return upCount; }
    public int getDownCount() { return downCount; }
    public int getCommentCount() { return commentCount; }

    public boolean isAuthoredBy(UUID userId) {
        return authorId != null && authorId.equals(userId);
    }

    public void moderate(ProposalStatus status, String rejectionReason, UUID moderatorId, OffsetDateTime at) {
        this.status = status;
        this.rejectionReason = rejectionReason;
        this.moderatedBy = moderatorId;
        this.moderatedAt = at;
    }

    public void setLifecycle(ProposalLifecycle lifecycle) { this.lifecycle = lifecycle; }

    // Deltas may be negative; the DB CHECK rejects a counter below zero.
    public void adjustVotes(int upDelta, int downDelta) {
        this.upCount += upDelta;
        this.downCount += downDelta;
    }

    public void adjustComments(int delta) {
        this.commentCount += delta;
    }
}
