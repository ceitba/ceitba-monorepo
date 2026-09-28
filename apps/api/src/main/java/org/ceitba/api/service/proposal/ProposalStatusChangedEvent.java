package org.ceitba.api.service.proposal;

import java.util.UUID;

// Published by ProposalModerationService after a moderator changes a
// proposal's moderation status or lifecycle, inside the moderating
// transaction. ProposalStatusPushNotifier turns it into a push to the author
// (delivered after commit by PushTriggerListener); other listeners that do
// I/O should use @TransactionalEventListener(phase = AFTER_COMMIT).
//
// newStatus is either a ProposalStatus name (APPROVED, REJECTED) or a
// ProposalLifecycle name (ABIERTO, ACEPTADO, CERRADO); the two sets do not
// overlap. authorId is null when the author deleted their account.
public record ProposalStatusChangedEvent(
    UUID proposalId,
    UUID authorId,
    String newStatus
) {}
