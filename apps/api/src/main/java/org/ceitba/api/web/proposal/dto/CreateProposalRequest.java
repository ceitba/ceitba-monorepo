package org.ceitba.api.web.proposal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.proposal.ProposalTopic;

import java.util.List;

// attachmentKeys: keys returned by POST /v1/proposals/attachments/sign-upload
// (uploaded by this same user), in display order; the first is the cover.
public record CreateProposalRequest(
    @NotBlank @Size(max = 100) @Pattern(regexp = "[^\\r\\n]*", message = "must be a single line") String title,
    @NotBlank @Size(max = 5000) String description,
    @NotNull ProposalTopic topic,
    @Size(max = 5) List<@NotBlank String> attachmentKeys
) {}
