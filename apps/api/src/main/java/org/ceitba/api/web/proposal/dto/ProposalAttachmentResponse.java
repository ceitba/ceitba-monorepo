package org.ceitba.api.web.proposal.dto;

// position 0 is the cover. url is null when object storage is not configured.
public record ProposalAttachmentResponse(
    int position,
    String url,
    String contentType
) {}
