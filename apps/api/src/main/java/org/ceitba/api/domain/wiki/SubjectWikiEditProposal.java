package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.ceitba.api.domain.ProposalStatus;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "subject_wiki_edit_proposal")
public class SubjectWikiEditProposal {

    @Id
    private UUID id;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    // Two FK references to user.id (proposer + reviewer). Stored as UUIDs
    // rather than @ManyToOne to keep the User entity from growing more
    // bidirectional collections (see MIGRATION.md §3 rule).
    @Column(name = "proposed_by", nullable = false)
    private UUID proposedBy;

    @CreationTimestamp
    @Column(name = "proposed_at", nullable = false, updatable = false)
    private OffsetDateTime proposedAt;

    @Column(name = "proposed_content", nullable = false, columnDefinition = "text")
    private String proposedContent;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "proposal_status")
    private ProposalStatus status = ProposalStatus.PENDING;

    @Column(name = "reviewed_by")
    private UUID reviewedBy;

    @Column(name = "reviewed_at")
    private OffsetDateTime reviewedAt;

    @Column(name = "review_comment", length = 1024)
    private String reviewComment;

    protected SubjectWikiEditProposal() {}

    public SubjectWikiEditProposal(UUID id, String subjectId, UUID proposedBy, String proposedContent) {
        this.id = id;
        this.subjectId = subjectId;
        this.proposedBy = proposedBy;
        this.proposedContent = proposedContent;
    }

    public UUID getId() { return id; }
    public String getSubjectId() { return subjectId; }
    public UUID getProposedBy() { return proposedBy; }
    public OffsetDateTime getProposedAt() { return proposedAt; }
    public String getProposedContent() { return proposedContent; }
    public ProposalStatus getStatus() { return status; }
    public UUID getReviewedBy() { return reviewedBy; }
    public OffsetDateTime getReviewedAt() { return reviewedAt; }
    public String getReviewComment() { return reviewComment; }

    public void setStatus(ProposalStatus status) { this.status = status; }
    public void setReviewedBy(UUID reviewedBy) { this.reviewedBy = reviewedBy; }
    public void setReviewedAt(OffsetDateTime reviewedAt) { this.reviewedAt = reviewedAt; }
    public void setReviewComment(String reviewComment) { this.reviewComment = reviewComment; }
}
