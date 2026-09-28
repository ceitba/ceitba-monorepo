package org.ceitba.api.service.push.events;

import org.ceitba.api.service.push.PushMessage;

/**
 * An application event asking for a push notification. Publishing one is the
 * only way feature code should send pushes.
 *
 * <p>Delivery happens in {@code PushTriggerListener}: after the publishing
 * transaction commits (a rollback drops the push; when published outside a
 * transaction it is delivered right away), on a background thread, so FCM
 * latency or failures never affect the request. Failures are logged, not
 * retried.
 *
 * <p>How to send from a new feature (e.g. proposals):
 * <pre>{@code
 * @Service
 * public class ProposalService {
 *     private final ApplicationEventPublisher events;
 *
 *     @Transactional
 *     public void approve(Proposal p) {
 *         p.setStatus(APPROVED);
 *         events.publishEvent(new PushToUsers(Set.of(p.getAuthorId()),
 *             PushMessage.forResource("Tu propuesta fue aprobada", p.getTitle(),
 *                                     "proposal", p.getId().toString())));
 *     }
 * }
 * }</pre>
 * Keep {@code data} small and string-only; the app routes on its
 * {@code type} and {@code id} keys ({@link PushMessage#forResource}). Pick a
 * new {@code type} value per resource kind and tell the app about it.
 */
public sealed interface PushTrigger permits PushToUsers, PushToOrgFollowers, PushBroadcast {

    PushMessage message();
}
