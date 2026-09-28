package org.ceitba.api.service.proposal;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalAttachment;
import org.ceitba.api.domain.proposal.ProposalComment;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.domain.proposal.ProposalVote;
import org.ceitba.api.domain.proposal.ProposalVoteId;
import org.ceitba.api.domain.proposal.ProposalVoteValue;
import org.ceitba.api.repository.proposal.ProposalAliasRepository;
import org.ceitba.api.repository.proposal.ProposalAttachmentRepository;
import org.ceitba.api.repository.proposal.ProposalCommentRepository;
import org.ceitba.api.repository.proposal.ProposalRepository;
import org.ceitba.api.repository.proposal.ProposalVoteRepository;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.proposal.dto.CreateProposalCommentRequest;
import org.ceitba.api.web.proposal.dto.CreateProposalRequest;
import org.ceitba.api.web.proposal.dto.ProposalCommentResponse;
import org.ceitba.api.web.proposal.dto.ProposalResponse;
import org.ceitba.api.web.proposal.dto.ProposalVoteResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

// Student-facing proposals board.
//
// Visibility: APPROVED proposals are public to every signed-in user; a
// PENDING or REJECTED one only to its author and moderators, and 404 to
// everyone else (existence is not revealed).
// Interaction: votes and comments need an APPROVED proposal whose lifecycle
// is not CERRADO (409 otherwise).
// Counters (up/down/comment) change in the same transaction as the vote or
// comment row, under a row lock on the proposal.
// Rate limits: creating proposals and posting comments are per-user quotas
// (rate-limit.user-rules.proposals / proposal-comments), taken only once the
// request is otherwise valid, so rejected requests do not burn quota.
@Service
public class ProposalService {

    public static final int MAX_PAGE_SIZE = 50;
    public static final String CREATE_RATE_RULE = "proposals";
    public static final String COMMENT_RATE_RULE = "proposal-comments";

    private final ProposalRepository proposals;
    private final ProposalAttachmentRepository attachments;
    private final ProposalVoteRepository votes;
    private final ProposalCommentRepository comments;
    private final ProposalAliasRepository aliases;
    private final ProposalAliasService aliasService;
    private final ProposalViews views;
    private final MediaUploadService media;
    private final UserRateLimiter rateLimiter;
    private final Clock clock;

    public ProposalService(ProposalRepository proposals, ProposalAttachmentRepository attachments,
                           ProposalVoteRepository votes, ProposalCommentRepository comments,
                           ProposalAliasRepository aliases, ProposalAliasService aliasService,
                           ProposalViews views, MediaUploadService media, UserRateLimiter rateLimiter,
                           Clock clock) {
        this.proposals = proposals;
        this.attachments = attachments;
        this.votes = votes;
        this.comments = comments;
        this.aliases = aliases;
        this.aliasService = aliasService;
        this.views = views;
        this.media = media;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
    }

    // --- Reads ---------------------------------------------------------------

    @Transactional(readOnly = true)
    public PageResponse<ProposalResponse> listApproved(ProposalTopic topic, int page, int limit, UUID viewerId) {
        var pageable = pageable(page, limit);
        Page<Proposal> result = topic == null
            ? proposals.findByStatusOrderByCreatedAtDescIdDesc(ProposalStatus.APPROVED, pageable)
            : proposals.findByStatusAndTopicOrderByCreatedAtDescIdDesc(ProposalStatus.APPROVED, topic, pageable);
        return page(result, views.many(result.getContent(), viewerId, false), page, limit);
    }

    @Transactional(readOnly = true)
    public PageResponse<ProposalResponse> listMine(UUID userId, int page, int limit) {
        Page<Proposal> result = proposals.findByAuthorIdOrderByCreatedAtDescIdDesc(userId, pageable(page, limit));
        return page(result, views.many(result.getContent(), userId, false), page, limit);
    }

    @Transactional(readOnly = true)
    public ProposalResponse get(UUID id, UUID viewerId, boolean moderator) {
        return views.one(visible(proposals.findById(id), id, viewerId, moderator), viewerId, moderator);
    }

    @Transactional(readOnly = true)
    public PageResponse<ProposalCommentResponse> listComments(UUID proposalId, UUID viewerId, boolean moderator,
                                                              int page, int limit) {
        Proposal p = visible(proposals.findById(proposalId), proposalId, viewerId, moderator);
        Page<ProposalComment> threads = comments.findThreads(p.getId(), pageable(page, limit));

        List<UUID> threadIds = threads.getContent().stream().map(ProposalComment::getId).toList();
        Map<UUID, List<ProposalComment>> replies = threadIds.isEmpty() ? Map.of()
            : comments.findByParentIdInAndDeletedAtIsNullOrderByCreatedAtAscIdAsc(threadIds).stream()
                .collect(Collectors.groupingBy(ProposalComment::getParentId));

        Set<UUID> authorIds = Stream.concat(threads.getContent().stream(),
                replies.values().stream().flatMap(List::stream))
            .map(ProposalComment::getAuthorId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
        Map<UUID, String> aliasByUser = new HashMap<>();
        if (!authorIds.isEmpty()) {
            aliases.findByProposalIdAndUserIdIn(p.getId(), authorIds)
                .forEach(a -> aliasByUser.put(a.getUserId(), a.getAlias()));
        }

        List<ProposalCommentResponse> data = threads.getContent().stream()
            .map(c -> toResponse(c, p, viewerId, aliasByUser,
                replies.getOrDefault(c.getId(), List.of()).stream()
                    .map(r -> toResponse(r, p, viewerId, aliasByUser, List.of()))
                    .toList()))
            .toList();
        return page(threads, data, page, limit);
    }

    // --- Writes --------------------------------------------------------------

    @Transactional
    public ProposalResponse create(UUID authorId, CreateProposalRequest req) {
        List<String> keys = req.attachmentKeys() == null ? List.of() : req.attachmentKeys();
        if (new LinkedHashSet<>(keys).size() != keys.size()) {
            throw new ValidationException("attachmentKeys", keys, "duplicate keys");
        }
        List<String> contentTypes = new ArrayList<>(keys.size());
        for (String key : keys) {
            contentTypes.add(media.proposalAttachmentContentType(authorId, key)
                .orElseThrow(() -> new ValidationException("attachmentKeys", key,
                    "not an attachment key signed for this user")));
        }
        if (!keys.isEmpty() && attachments.existsByObjectKeyIn(keys)) {
            throw new ValidationException("attachmentKeys", keys, "attachment already used by another proposal");
        }
        rateLimiter.consume(CREATE_RATE_RULE, authorId);

        Proposal p = proposals.saveAndFlush(
            new Proposal(authorId, req.title().trim(), req.description().trim(), req.topic()));
        for (int i = 0; i < keys.size(); i++) {
            attachments.save(new ProposalAttachment(p.getId(), i, keys.get(i), contentTypes.get(i)));
        }
        // The author's pseudonym is fixed up front so it is the same one
        // their comments on this proposal will carry.
        aliasService.aliasFor(p.getId(), authorId);
        attachments.flush();
        return views.one(p, authorId, false);
    }

    @Transactional
    public ProposalVoteResponse vote(UUID proposalId, UUID userId, ProposalVoteValue value) {
        Proposal p = interactive(proposalId, userId);
        var id = new ProposalVoteId(proposalId, userId);
        var existing = votes.findById(id);
        if (existing.isEmpty()) {
            votes.save(new ProposalVote(proposalId, userId, value));
            p.adjustVotes(value == ProposalVoteValue.UP ? 1 : 0, value == ProposalVoteValue.DOWN ? 1 : 0);
        } else if (existing.get().getValue() != value) {
            existing.get().setValue(value);
            int toUp = value == ProposalVoteValue.UP ? 1 : -1;
            p.adjustVotes(toUp, -toUp);
        }
        return new ProposalVoteResponse(p.getUpCount(), p.getDownCount(), value);
    }

    // Idempotent: removing a vote that does not exist is a no-op. Allowed on
    // closed proposals so users can always take their vote back.
    @Transactional
    public ProposalVoteResponse removeVote(UUID proposalId, UUID userId) {
        Proposal p = visible(proposals.findForUpdate(proposalId), proposalId, userId, false);
        votes.findById(new ProposalVoteId(proposalId, userId)).ifPresent(v -> {
            p.adjustVotes(v.getValue() == ProposalVoteValue.UP ? -1 : 0, v.getValue() == ProposalVoteValue.DOWN ? -1 : 0);
            votes.delete(v);
        });
        return new ProposalVoteResponse(p.getUpCount(), p.getDownCount(), null);
    }

    @Transactional
    public ProposalCommentResponse addComment(UUID proposalId, UUID userId, CreateProposalCommentRequest req) {
        Proposal p = interactive(proposalId, userId);
        if (req.parentId() != null) {
            ProposalComment parent = comments.findByIdAndProposalId(req.parentId(), proposalId)
                .orElseThrow(() -> new ValidationException("parentId", req.parentId(), "no such comment on this proposal"));
            if (parent.getParentId() != null) {
                throw new ValidationException("parentId", req.parentId(), "replies can only answer a top-level comment");
            }
            if (parent.isDeleted()) {
                throw new ValidationException("parentId", req.parentId(), "comment was deleted");
            }
        }
        rateLimiter.consume(COMMENT_RATE_RULE, userId);
        String alias = aliasService.aliasFor(proposalId, userId);
        ProposalComment c = comments.saveAndFlush(
            new ProposalComment(proposalId, userId, req.parentId(), req.body().trim()));
        p.adjustComments(1);
        return toResponse(c, p, userId, Map.of(userId, alias), List.of());
    }

    @Transactional
    public void deleteOwnComment(UUID proposalId, UUID commentId, UUID userId) {
        Proposal p = visible(proposals.findForUpdate(proposalId), proposalId, userId, false);
        ProposalComment c = comments.findByIdAndProposalId(commentId, proposalId)
            .filter(x -> !x.isDeleted() && userId.equals(x.getAuthorId()))
            .orElseThrow(() -> new ResourceNotFoundException("ProposalComment", commentId.toString()));
        c.softDelete(OffsetDateTime.now(clock));
        p.adjustComments(-1);
    }

    // --- Helpers -------------------------------------------------------------

    static Proposal visible(Optional<Proposal> found, UUID id, UUID viewerId, boolean moderator) {
        return found
            .filter(p -> p.getStatus() == ProposalStatus.APPROVED || moderator || p.isAuthoredBy(viewerId))
            .orElseThrow(() -> new ResourceNotFoundException("Proposal", id.toString()));
    }

    // Locked, visible to the user, APPROVED and not CERRADO.
    private Proposal interactive(UUID proposalId, UUID userId) {
        Proposal p = visible(proposals.findForUpdate(proposalId), proposalId, userId, false);
        if (p.getStatus() != ProposalStatus.APPROVED) {
            throw new InvalidStateException("Proposal is not approved yet");
        }
        if (p.getLifecycle() == ProposalLifecycle.CERRADO) {
            throw new InvalidStateException("Proposal is closed");
        }
        return p;
    }

    private static ProposalCommentResponse toResponse(ProposalComment c, Proposal p, UUID viewerId,
                                                      Map<UUID, String> aliasByUser,
                                                      List<ProposalCommentResponse> replies) {
        UUID author = c.getAuthorId();
        boolean deleted = c.isDeleted();
        return new ProposalCommentResponse(
            c.getId(), c.getParentId(),
            deleted || author == null ? null : aliasByUser.get(author),
            !deleted && author != null && author.equals(viewerId),
            !deleted && author != null && p.isAuthoredBy(author),
            deleted ? null : c.getBody(),
            deleted,
            c.getCreatedAt(),
            replies);
    }

    static PageRequest pageable(int page, int limit) {
        return PageRequest.of(Math.max(page, 1) - 1, clampLimit(limit));
    }

    static int clampLimit(int limit) {
        return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    }

    static <T> PageResponse<T> page(Page<?> result, List<T> data, int page, int limit) {
        return new PageResponse<>(data, new PageResponse.Meta(result.getTotalElements(), Math.max(page, 1),
            clampLimit(limit)));
    }
}
