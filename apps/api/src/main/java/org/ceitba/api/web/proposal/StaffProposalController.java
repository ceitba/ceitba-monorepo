package org.ceitba.api.web.proposal;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.proposal.ProposalModerationService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.proposal.dto.ProposalResponse;
import org.ceitba.api.web.proposal.dto.RejectProposalRequest;
import org.ceitba.api.web.proposal.dto.UpdateProposalLifecycleRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

// Proposal moderation. Open to ROLE_MODERATOR (active STAFF or a moderator
// grant), not only STAFF: SecurityConfig carves /v1/staff/proposals/** out
// of the STAFF-only /v1/staff/** rule. Authors are not revealed here either.
@Tag(name = "Proposals (moderation)")
@RestController
@RequestMapping("/v1/staff/proposals")
@PreAuthorize("hasRole('MODERATOR')")
public class StaffProposalController {

    private final ProposalModerationService service;

    public StaffProposalController(ProposalModerationService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Proposals in a moderation status (default PENDING), oldest first")
    public PageResponse<ProposalResponse> list(@CurrentUser User moderator,
                                               @RequestParam(defaultValue = "PENDING") ProposalStatus status,
                                               @RequestParam(defaultValue = "1") int page,
                                               @RequestParam(defaultValue = "20") int limit) {
        return service.list(status, page, limit, moderator.getId());
    }

    @PostMapping("/{id}/approve")
    @Operation(summary = "Approve a pending proposal")
    public ProposalResponse approve(@CurrentUser User moderator, @PathVariable UUID id) {
        return service.approve(id, moderator.getId());
    }

    @PostMapping("/{id}/reject")
    @Operation(summary = "Reject a pending proposal, or take down an approved one")
    public ProposalResponse reject(@CurrentUser User moderator, @PathVariable UUID id,
                                   @Valid @RequestBody RejectProposalRequest req) {
        return service.reject(id, moderator.getId(), req.reason());
    }

    @PatchMapping("/{id}")
    @Operation(summary = "Set an approved proposal's lifecycle (ABIERTO/ACEPTADO/CERRADO)")
    public ProposalResponse setLifecycle(@CurrentUser User moderator, @PathVariable UUID id,
                                         @Valid @RequestBody UpdateProposalLifecycleRequest req) {
        return service.setLifecycle(id, moderator.getId(), req.lifecycle());
    }

    @DeleteMapping("/{id}/comments/{commentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove any comment on a proposal")
    public void deleteComment(@PathVariable UUID id, @PathVariable UUID commentId) {
        service.deleteComment(id, commentId);
    }
}
