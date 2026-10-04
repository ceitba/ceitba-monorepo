package org.ceitba.api.scheduling;

import org.ceitba.api.service.digest.DigestSender;
import org.ceitba.api.service.digest.DigestService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

// Weekly digest background work (docs/WEEKLY-DIGEST.md):
//   - Monday 00:05 ART: draft for the week that just ended (auto-send 12:00)
//   - every digest.tick-interval (PT5M): start drafts whose auto-send time
//     has come, and resume issues still sending (quota hit, SMTP down, restart)
//   - right after a send starts, and at startup: run the worker
// The worker runs on the task executor (it can take ~25 min for 1500
// recipients at 1/s) so it never blocks the shared scheduler thread.
// Off with digest.jobs-enabled=false (tests).
@Component
@ConditionalOnProperty(name = "digest.jobs-enabled", havingValue = "true", matchIfMissing = true)
public class DigestJob {

    private static final Logger log = LoggerFactory.getLogger(DigestJob.class);

    private final DigestService service;
    private final DigestSender sender;
    private final TaskExecutor executor;

    public DigestJob(DigestService service, DigestSender sender,
                     @Qualifier("applicationTaskExecutor") TaskExecutor executor) {
        this.service = service;
        this.sender = sender;
        this.executor = executor;
    }

    void kick() {
        executor.execute(sender::runPending);
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onSendRequested(DigestService.SendRequested event) {
        kick();
    }

    @Scheduled(cron = "0 5 0 * * MON", zone = "America/Argentina/Buenos_Aires")
    public void createWeeklyDraft() {
        try {
            service.createScheduledDraft();
        } catch (RuntimeException e) {
            log.warn("Weekly digest draft could not be created: {}", e.getMessage());
        }
    }

    @Scheduled(fixedDelayString = "${digest.tick-interval:PT5M}", initialDelayString = "PT1M")
    public void tick() {
        try {
            service.startDueAutoSends();
        } catch (RuntimeException e) {
            log.warn("Digest auto-send check failed: {}", e.getMessage());
        }
        kick();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        kick();
    }
}
