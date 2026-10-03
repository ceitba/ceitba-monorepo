package org.ceitba.api.service.drive;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

// Runs a requested sync once the request's transaction committed, on Boot's
// applicationTaskExecutor (same pattern as PushTriggerListener), so the
// request never waits on Drive.
@Component
public class DriveSyncTrigger {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncTrigger.class);

    private final DriveSyncService sync;

    public DriveSyncTrigger(DriveSyncService sync) {
        this.sync = sync;
    }

    @Async("applicationTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void on(DriveSyncRequested event) {
        try {
            var outcome = sync.syncSource(event.sourceId());
            log.debug("Requested Drive sync of {}: {}", event.sourceId(), outcome);
        } catch (RuntimeException e) {
            log.error("Requested Drive sync of {} failed", event.sourceId(), e);
        }
    }
}
