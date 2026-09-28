package org.ceitba.api.domain.proposal;

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

// One vote per (proposal, user); changing it updates `value` in place.
@Entity
@Table(schema = "public", name = "proposal_vote")
@IdClass(ProposalVoteId.class)
public class ProposalVote {

    @Id
    @Column(name = "proposal_id", nullable = false)
    private UUID proposalId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4)
    private ProposalVoteValue value;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected ProposalVote() {}

    public ProposalVote(UUID proposalId, UUID userId, ProposalVoteValue value) {
        this.proposalId = proposalId;
        this.userId = userId;
        this.value = value;
    }

    public UUID getProposalId() { return proposalId; }
    public UUID getUserId() { return userId; }
    public ProposalVoteValue getValue() { return value; }

    public void setValue(ProposalVoteValue value) { this.value = value; }
}
