package org.ceitba.api.service.proposal;

import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalAlias;
import org.ceitba.api.domain.proposal.ProposalAttachment;
import org.ceitba.api.domain.proposal.ProposalVote;
import org.ceitba.api.repository.proposal.ProposalAliasRepository;
import org.ceitba.api.repository.proposal.ProposalAttachmentRepository;
import org.ceitba.api.repository.proposal.ProposalVoteRepository;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.web.proposal.dto.ProposalAttachmentResponse;
import org.ceitba.api.web.proposal.dto.ProposalResponse;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

// Builds ProposalResponses for one viewer with a fixed number of queries
// per batch (attachments, the viewer's votes, author aliases), not per row.
// Runs inside the calling service's transaction.
@Component
class ProposalViews {

    private final ProposalAttachmentRepository attachments;
    private final ProposalVoteRepository votes;
    private final ProposalAliasRepository aliases;
    private final MediaUploadService media;

    ProposalViews(ProposalAttachmentRepository attachments, ProposalVoteRepository votes,
                  ProposalAliasRepository aliases, MediaUploadService media) {
        this.attachments = attachments;
        this.votes = votes;
        this.aliases = aliases;
        this.media = media;
    }

    ProposalResponse one(Proposal p, UUID viewerId, boolean moderator) {
        return many(List.of(p), viewerId, moderator).get(0);
    }

    List<ProposalResponse> many(List<Proposal> proposals, UUID viewerId, boolean moderator) {
        if (proposals.isEmpty()) return List.of();
        List<UUID> ids = proposals.stream().map(Proposal::getId).toList();

        Map<UUID, List<ProposalAttachmentResponse>> files = new HashMap<>();
        for (ProposalAttachment a : attachments.findByProposalIdInOrderByPositionAsc(ids)) {
            files.computeIfAbsent(a.getProposalId(), k -> new ArrayList<>()).add(
                new ProposalAttachmentResponse(a.getPosition(), media.publicUrl(a.getObjectKey()), a.getContentType()));
        }
        Map<UUID, ProposalVote> myVotes = viewerId == null ? Map.of()
            : votes.findByUserIdAndProposalIdIn(viewerId, ids).stream()
                .collect(Collectors.toMap(ProposalVote::getProposalId, v -> v));
        Map<UUID, String> authorAliases = aliases.findAuthorAliases(ids).stream()
            .collect(Collectors.toMap(ProposalAlias::getProposalId, ProposalAlias::getAlias));

        return proposals.stream().map(p -> {
            boolean mine = p.isAuthoredBy(viewerId);
            ProposalVote vote = myVotes.get(p.getId());
            return new ProposalResponse(
                p.getId(), p.getTitle(), p.getDescription(), p.getTopic(), p.getStatus(), p.getLifecycle(),
                mine || moderator ? p.getRejectionReason() : null,
                files.getOrDefault(p.getId(), List.of()),
                p.getUpCount(), p.getDownCount(), p.getCommentCount(),
                vote == null ? null : vote.getValue(),
                mine,
                authorAliases.get(p.getId()),
                p.getCreatedAt(), p.getModeratedAt());
        }).toList();
    }
}
