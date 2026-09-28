package org.ceitba.api.service.proposal;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalComment;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.repository.proposal.ProposalCommentRepository;
import org.ceitba.api.repository.proposal.ProposalRepository;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.proposal.dto.ProposalResponse;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

// Moderator actions (ROLE_MODERATOR, enforced by SecurityConfig and the
// controller). Moderation status moves PENDING -> APPROVED | REJECTED, and
// an APPROVED proposal can later be taken down (-> REJECTED). The lifecycle
// (ABIERTO/ACEPTADO/CERRADO) is only set on APPROVED proposals. Every change
// publishes a ProposalStatusChangedEvent.
@Service
public class ProposalModerationService {

    private final ProposalRepository proposals;
    private final ProposalCommentRepository comments;
    private final ProposalViews views;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public ProposalModerationService(ProposalRepository proposals, ProposalCommentRepository comments,
                                     ProposalViews views, ApplicationEventPublisher events, Clock clock) {
        this.proposals = proposals;
        this.comments = comments;
        this.views = views;
        this.events = events;
        this.clock = clock;
    }

    // Queue for a moderation status, oldest first.
    @Transactional(readOnly = true)
    public PageResponse<ProposalResponse> list(ProposalStatus status, int page, int limit, UUID moderatorId) {
        Page<Proposal> result = proposals.findByStatusOrderByCreatedAtAscIdAsc(
            status, ProposalService.pageable(page, limit));
        return ProposalService.page(result, views.many(result.getContent(), moderatorId, true), page, limit);
    }

    @Transactional
    public ProposalResponse approve(UUID proposalId, UUID moderatorId) {
        Proposal p = locked(proposalId);
        if (p.getStatus() != ProposalStatus.PENDING) {
            throw new InvalidStateException("Proposal is already " + p.getStatus());
        }
        p.moderate(ProposalStatus.APPROVED, null, moderatorId, OffsetDateTime.now(clock));
        publish(p, ProposalStatus.APPROVED.name());
        return views.one(p, moderatorId, true);
    }

    @Transactional
    public ProposalResponse reject(UUID proposalId, UUID moderatorId, String reason) {
        Proposal p = locked(proposalId);
        if (p.getStatus() == ProposalStatus.REJECTED) {
            throw new InvalidStateException("Proposal is already REJECTED");
        }
        p.moderate(ProposalStatus.REJECTED, reason.trim(), moderatorId, OffsetDateTime.now(clock));
        publish(p, ProposalStatus.REJECTED.name());
        return views.one(p, moderatorId, true);
    }

    @Transactional
    public ProposalResponse setLifecycle(UUID proposalId, UUID moderatorId, ProposalLifecycle lifecycle) {
        Proposal p = locked(proposalId);
        if (p.getStatus() != ProposalStatus.APPROVED) {
            throw new InvalidStateException("Only approved proposals have a lifecycle");
        }
        if (p.getLifecycle() != lifecycle) {
            p.setLifecycle(lifecycle);
            publish(p, lifecycle.name());
        }
        return views.one(p, moderatorId, true);
    }

    @Transactional
    public void deleteComment(UUID proposalId, UUID commentId) {
        Proposal p = locked(proposalId);
        ProposalComment c = comments.findByIdAndProposalId(commentId, proposalId)
            .orElseThrow(() -> new ResourceNotFoundException("ProposalComment", commentId.toString()));
        if (!c.isDeleted()) {
            c.softDelete(OffsetDateTime.now(clock));
            p.adjustComments(-1);
        }
    }

    private Proposal locked(UUID proposalId) {
        return proposals.findForUpdate(proposalId)
            .orElseThrow(() -> new ResourceNotFoundException("Proposal", proposalId.toString()));
    }

    private void publish(Proposal p, String newStatus) {
        events.publishEvent(new ProposalStatusChangedEvent(p.getId(), p.getAuthorId(), newStatus));
    }
}
