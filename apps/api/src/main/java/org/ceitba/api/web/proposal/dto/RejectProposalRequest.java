package org.ceitba.api.web.proposal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RejectProposalRequest(
    @NotBlank @Size(max = 1024) String reason
) {}
