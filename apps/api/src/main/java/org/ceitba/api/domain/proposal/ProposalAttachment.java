package org.ceitba.api.domain.proposal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.util.UUID;

// An uploaded object attached to a proposal, in display order (position 0
// is the cover). object_key is the storage key; URLs are derived from it.
@Entity
@Table(schema = "public", name = "proposal_attachment")
@IdClass(ProposalAttachmentId.class)
public class ProposalAttachment {

    @Id
    @Column(name = "proposal_id", nullable = false)
    private UUID proposalId;

    @Id
    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "object_key", nullable = false, unique = true)
    private String objectKey;

    @Column(name = "content_type", nullable = false, length = 64)
    private String contentType;

    protected ProposalAttachment() {}

    public ProposalAttachment(UUID proposalId, int position, String objectKey, String contentType) {
        this.proposalId = proposalId;
        this.position = position;
        this.objectKey = objectKey;
        this.contentType = contentType;
    }

    public UUID getProposalId() { return proposalId; }
    public int getPosition() { return position; }
    public String getObjectKey() { return objectKey; }
    public String getContentType() { return contentType; }
}
