package org.ceitba.api.domain.proposal;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class ProposalAttachmentId implements Serializable {

    private UUID proposalId;
    private int position;

    public ProposalAttachmentId() {}

    public ProposalAttachmentId(UUID proposalId, int position) {
        this.proposalId = proposalId;
        this.position = position;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ProposalAttachmentId other)) return false;
        return Objects.equals(proposalId, other.proposalId)
            && Objects.equals(position, other.position);
    }

    @Override
    public int hashCode() {
        return Objects.hash(proposalId, position);
    }
}
