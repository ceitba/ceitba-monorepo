package org.ceitba.api.domain.proposal;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class ProposalVoteId implements Serializable {

    private UUID proposalId;
    private UUID userId;

    public ProposalVoteId() {}

    public ProposalVoteId(UUID proposalId, UUID userId) {
        this.proposalId = proposalId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ProposalVoteId other)) return false;
        return Objects.equals(proposalId, other.proposalId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(proposalId, userId);
    }
}
