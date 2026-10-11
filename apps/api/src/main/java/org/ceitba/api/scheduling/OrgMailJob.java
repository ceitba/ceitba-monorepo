package org.ceitba.api.scheduling;

import org.ceitba.api.service.orgmail.OrgAnnouncementSender;
import org.ceitba.api.service.orgmail.OrgAnnouncementService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

// Runs OrgAnnouncementSender on the task executor: right after an
// announcement starts sending, at startup, and every org-mail.tick-interval
// (PT2M) to resume what a quota pause, a broken account or a restart left
// pending. Off with org-mail.jobs-enabled=false (tests).
@Component
@ConditionalOnProperty(name = "org-mail.jobs-enabled", havingValue = "true", matchIfMissing = true)
public class OrgMailJob {

    private static final Logger log = LoggerFactory.getLogger(OrgMailJob.class);

    private final OrgAnnouncementSender sender;
    private final TaskExecutor executor;
    private final JobLock jobLock;

    public OrgMailJob(OrgAnnouncementSender sender, @Qualifier("applicationTaskExecutor") TaskExecutor executor,
                      JobLock jobLock) {
        this.sender = sender;
        this.executor = executor;
        this.jobLock = jobLock;
    }

    void kick() {
        try {
            executor.execute(sender::runPending);
        } catch (TaskRejectedException e) {
            log.debug("Org mail worker not started: executor is shutting down");
        }
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onSendRequested(OrgAnnouncementService.SendRequested event) {
        kick();
    }

    @Scheduled(fixedDelayString = "${org-mail.tick-interval:PT2M}", initialDelayString = "PT1M")
    public void tick() {
        jobLock.runExclusively(JobLock.Job.ORG_MAIL, () -> {
            kick();
        });
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        kick();
    }
}
