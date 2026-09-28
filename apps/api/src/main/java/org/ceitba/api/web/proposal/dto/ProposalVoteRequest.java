package org.ceitba.api.web.proposal.dto;

import jakarta.validation.constraints.NotNull;
import org.ceitba.api.domain.proposal.ProposalVoteValue;

// value: "UP" or "DOWN" (case-insensitive, like every proposal enum).
public record ProposalVoteRequest(
    @NotNull ProposalVoteValue value
) {}
