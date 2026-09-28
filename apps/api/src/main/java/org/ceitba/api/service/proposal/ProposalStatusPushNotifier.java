package org.ceitba.api.service.proposal;

import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.repository.proposal.ProposalRepository;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.events.PushToUsers;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Set;

// Tells a proposal's author when a moderator changes its status or lifecycle.
//
// Runs synchronously inside the moderating transaction (plain @EventListener)
// and only translates the ProposalStatusChangedEvent into a PushToUsers
// trigger; PushTriggerListener then sends it through PushNotificationService
// after commit, on a background thread. A rolled-back moderation sends nothing.
//
// Push: title per new status (below), body = proposal title,
// data {type: "proposal", id}. No push when the author deleted their account
// (authorId null) or the status is not one this class knows.
@Component
public class ProposalStatusPushNotifier {

    public static final String PUSH_TYPE = "proposal";

    private final ProposalRepository proposals;
    private final ApplicationEventPublisher events;

    public ProposalStatusPushNotifier(ProposalRepository proposals, ApplicationEventPublisher events) {
        this.proposals = proposals;
        this.events = events;
    }

    @EventListener
    public void on(ProposalStatusChangedEvent event) {
        if (event.authorId() == null) return;
        String title = titleFor(event.newStatus());
        if (title == null) return;
        // The moderation service holds this row (locked), so this is a
        // persistence-context hit, not a query.
        proposals.findById(event.proposalId())
            .map(Proposal::getTitle)
            .ifPresent(body -> events.publishEvent(new PushToUsers(Set.of(event.authorId()),
                PushMessage.forResource(title, body, PUSH_TYPE, event.proposalId().toString()))));
    }

    static String titleFor(String newStatus) {
        if (newStatus == null) return null;
        return switch (newStatus) {
            case "APPROVED" -> "Tu propuesta fue aprobada";
            case "REJECTED" -> "Tu propuesta fue rechazada";
            case "ACEPTADO" -> "Tu propuesta fue aceptada";
            case "CERRADO"  -> "Tu propuesta fue cerrada";
            case "ABIERTO"  -> "Tu propuesta volvió a estar abierta";
            default         -> null;
        };
    }
}
