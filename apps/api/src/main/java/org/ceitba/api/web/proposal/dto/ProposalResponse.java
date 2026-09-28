package org.ceitba.api.web.proposal.dto;

import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.domain.proposal.ProposalVoteValue;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Never carries user ids or names: the author shows as `authorAlias` (their
// per-proposal pseudonym) and `isMine` tells the caller whether it is theirs.
// rejectionReason is only filled for the author and moderators.
// myVote: the caller's vote, or null.
public record ProposalResponse(
    UUID id,
    String title,
    String description,
    ProposalTopic topic,
    ProposalStatus status,
    ProposalLifecycle lifecycle,
    String rejectionReason,
    List<ProposalAttachmentResponse> attachments,
    int upCount,
    int downCount,
    int commentCount,
    ProposalVoteValue myVote,
    boolean isMine,
    String authorAlias,
    OffsetDateTime createdAt,
    OffsetDateTime moderatedAt
) {}
