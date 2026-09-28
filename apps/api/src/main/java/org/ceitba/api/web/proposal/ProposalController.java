package org.ceitba.api.web.proposal;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.service.proposal.ProposalService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.proposal.dto.CreateProposalCommentRequest;
import org.ceitba.api.web.proposal.dto.CreateProposalRequest;
import org.ceitba.api.web.proposal.dto.ProposalCommentResponse;
import org.ceitba.api.web.proposal.dto.ProposalResponse;
import org.ceitba.api.web.proposal.dto.ProposalVoteRequest;
import org.ceitba.api.web.proposal.dto.ProposalVoteResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

// Student proposals board. Every endpoint needs a signed-in, allowlisted
// user. Responses identify people only by per-proposal pseudonyms (alias,
// isMine, isAuthor); user ids and names are never returned.
// Pagination: ?page (1-based) & limit (1..50) -> {data, meta:{total, page, limit}}.
@Tag(name = "Proposals")
@RestController
public class ProposalController {

    private final ProposalService service;

    public ProposalController(ProposalService service) {
        this.service = service;
    }

    @GetMapping("/v1/proposals")
    @Operation(summary = "Approved proposals, newest first, optionally by topic")
    public PageResponse<ProposalResponse> list(@CurrentUser User user,
                                               @RequestParam(required = false) ProposalTopic topic,
                                               @RequestParam(defaultValue = "1") int page,
                                               @RequestParam(defaultValue = "20") int limit) {
        return service.listApproved(topic, page, limit, user.getId());
    }

    @GetMapping("/v1/me/proposals")
    @Operation(summary = "My proposals in any moderation status, newest first")
    public PageResponse<ProposalResponse> mine(@CurrentUser User user,
                                               @RequestParam(defaultValue = "1") int page,
                                               @RequestParam(defaultValue = "20") int limit) {
        return service.listMine(user.getId(), page, limit);
    }

    @GetMapping("/v1/proposals/{id}")
    @Operation(summary = "A proposal: approved, mine, or any for moderators (404 otherwise)")
    public ProposalResponse get(@CurrentUser User user, Authentication auth, @PathVariable UUID id) {
        return service.get(id, user.getId(), isModerator(auth));
    }

    @PostMapping("/v1/proposals")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Submit a proposal for moderation (status PENDING)")
    public ProposalResponse create(@CurrentUser User user, @Valid @RequestBody CreateProposalRequest req) {
        return service.create(user.getId(), req);
    }

    @PutMapping("/v1/proposals/{id}/vote")
    @Operation(summary = "Cast or change my vote (UP/DOWN)")
    public ProposalVoteResponse vote(@CurrentUser User user, @PathVariable UUID id,
                                     @Valid @RequestBody ProposalVoteRequest req) {
        return service.vote(id, user.getId(), req.value());
    }

    @DeleteMapping("/v1/proposals/{id}/vote")
    @Operation(summary = "Remove my vote (no-op if none)")
    public ProposalVoteResponse removeVote(@CurrentUser User user, @PathVariable UUID id) {
        return service.removeVote(id, user.getId());
    }

    @GetMapping("/v1/proposals/{id}/comments")
    @Operation(summary = "Top-level comments newest first, each with its replies")
    public PageResponse<ProposalCommentResponse> comments(@CurrentUser User user, Authentication auth,
                                                          @PathVariable UUID id,
                                                          @RequestParam(defaultValue = "1") int page,
                                                          @RequestParam(defaultValue = "20") int limit) {
        return service.listComments(id, user.getId(), isModerator(auth), page, limit);
    }

    @PostMapping("/v1/proposals/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Comment (or reply with parentId) under my pseudonym")
    public ProposalCommentResponse comment(@CurrentUser User user, @PathVariable UUID id,
                                           @Valid @RequestBody CreateProposalCommentRequest req) {
        return service.addComment(id, user.getId(), req);
    }

    @DeleteMapping("/v1/proposals/{id}/comments/{commentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete my own comment")
    public void deleteComment(@CurrentUser User user, @PathVariable UUID id, @PathVariable UUID commentId) {
        service.deleteOwnComment(id, commentId, user.getId());
    }

    static boolean isModerator(Authentication auth) {
        return auth != null && auth.getAuthorities().stream()
            .anyMatch(a -> "ROLE_MODERATOR".equals(a.getAuthority()));
    }
}
