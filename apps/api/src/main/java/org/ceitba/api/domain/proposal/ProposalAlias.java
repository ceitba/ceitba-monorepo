package org.ceitba.api.domain.proposal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A user's pseudonym on one proposal. Unique per proposal, never changes.
@Entity
@Table(schema = "public", name = "proposal_alias")
@IdClass(ProposalAliasId.class)
public class ProposalAlias {

    @Id
    @Column(name = "proposal_id", nullable = false)
    private UUID proposalId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 40)
    private String alias;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected ProposalAlias() {}

    public ProposalAlias(UUID proposalId, UUID userId, String alias) {
        this.proposalId = proposalId;
        this.userId = userId;
        this.alias = alias;
    }

    public UUID getProposalId() { return proposalId; }
    public UUID getUserId() { return userId; }
    public String getAlias() { return alias; }
}
