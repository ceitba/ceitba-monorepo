package org.ceitba.api.repository.proposal;

import org.ceitba.api.domain.proposal.ProposalVote;
import org.ceitba.api.domain.proposal.ProposalVoteId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ProposalVoteRepository extends JpaRepository<ProposalVote, ProposalVoteId> {

    List<ProposalVote> findByUserIdAndProposalIdIn(UUID userId, Collection<UUID> proposalIds);
}
