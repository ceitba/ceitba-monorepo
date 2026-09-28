package org.ceitba.api.service.push;

import org.ceitba.api.service.push.events.PushBroadcast;
import org.ceitba.api.service.push.events.PushToOrgFollowers;
import org.ceitba.api.service.push.events.PushToUsers;
import org.ceitba.api.service.push.events.PushTrigger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

// Delivers PushTrigger events: only once the publishing transaction has
// committed (fallbackExecution: immediately when there is none), on Boot's
// applicationTaskExecutor so the request never waits on FCM.
@Component
public class PushTriggerListener {

    private static final Logger log = LoggerFactory.getLogger(PushTriggerListener.class);

    private final PushNotificationService push;

    public PushTriggerListener(PushNotificationService push) {
        this.push = push;
    }

    @Async("applicationTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void on(PushTrigger trigger) {
        try {
            var result = switch (trigger) {
                case PushToUsers t        -> push.sendToUsers(t.userIds(), t.message());
                case PushToOrgFollowers t -> push.sendToOrgFollowers(t.orgSlug(), t.message());
                case PushBroadcast t      -> push.broadcast(t.message());
            };
            log.debug("{} delivered: {}", trigger.getClass().getSimpleName(), result);
        } catch (RuntimeException e) {
            log.error("Push delivery failed for {}", trigger.getClass().getSimpleName(), e);
        }
    }
}
