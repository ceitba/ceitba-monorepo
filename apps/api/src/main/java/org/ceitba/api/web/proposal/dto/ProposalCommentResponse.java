package org.ceitba.api.web.proposal.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// alias: the commenter's pseudonym on this proposal (null for a deleted
// comment or a deleted account). isMine: written by the caller. isAuthor:
// written by the proposal's author ("Autor" badge). Deleted comments are
// only listed while they have replies, with body null and deleted=true.
// replies: oldest first, only on top-level comments (one level deep).
public record ProposalCommentResponse(
    UUID id,
    UUID parentId,
    String alias,
    boolean isMine,
    boolean isAuthor,
    String body,
    boolean deleted,
    OffsetDateTime createdAt,
    List<ProposalCommentResponse> replies
) {}
