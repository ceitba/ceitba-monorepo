package org.ceitba.api.web.proposal.dto;

import org.ceitba.api.domain.proposal.ProposalVoteValue;

public record ProposalVoteResponse(
    int upCount,
    int downCount,
    ProposalVoteValue myVote
) {}
