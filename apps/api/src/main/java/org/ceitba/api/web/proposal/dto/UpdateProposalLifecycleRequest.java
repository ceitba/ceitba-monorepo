package org.ceitba.api.web.proposal.dto;

import jakarta.validation.constraints.NotNull;
import org.ceitba.api.domain.proposal.ProposalLifecycle;

public record UpdateProposalLifecycleRequest(
    @NotNull ProposalLifecycle lifecycle
) {}
