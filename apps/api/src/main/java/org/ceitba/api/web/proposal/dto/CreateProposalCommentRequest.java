package org.ceitba.api.web.proposal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

// parentId: reply to this top-level comment of the same proposal.
public record CreateProposalCommentRequest(
    @NotBlank @Size(max = 1000) String body,
    UUID parentId
) {}
