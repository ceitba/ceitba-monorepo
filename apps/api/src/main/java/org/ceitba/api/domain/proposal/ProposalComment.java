package org.ceitba.api.domain.proposal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A comment, or a reply when parentId is set (one level deep). Deleting is
// soft: deletedAt is set and the body cleared, so replies keep their parent.
@Entity
@Table(schema = "public", name = "proposal_comment")
public class ProposalComment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "proposal_id", nullable = false)
    private UUID proposalId;

    @Column(name = "author_id")
    private UUID authorId;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(columnDefinition = "text")
    private String body;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    protected ProposalComment() {}

    public ProposalComment(UUID proposalId, UUID authorId, UUID parentId, String body) {
        this.proposalId = proposalId;
        this.authorId = authorId;
        this.parentId = parentId;
        this.body = body;
    }

    public UUID getId() { return id; }
    public UUID getProposalId() { return proposalId; }
    public UUID getAuthorId() { return authorId; }
    public UUID getParentId() { return parentId; }
    public String getBody() { return body; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getDeletedAt() { return deletedAt; }

    public boolean isDeleted() { return deletedAt != null; }

    public void softDelete(OffsetDateTime at) {
        this.deletedAt = at;
        this.body = null;
    }
}
