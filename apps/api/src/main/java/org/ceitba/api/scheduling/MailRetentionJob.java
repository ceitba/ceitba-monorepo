package org.ceitba.api.scheduling;

import org.ceitba.api.service.mail.MailRetentionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Nightly 03:40 ART: retention of the mail send log and tracking data
// (MailRetentionService). Off with digest.jobs-enabled=false (tests).
@Component
@ConditionalOnProperty(name = "digest.jobs-enabled", havingValue = "true", matchIfMissing = true)
public class MailRetentionJob {

    private static final Logger log = LoggerFactory.getLogger(MailRetentionJob.class);

    private final MailRetentionService retention;
    private final JobLock jobLock;

    public MailRetentionJob(MailRetentionService retention, JobLock jobLock) {
        this.retention = retention;
        this.jobLock = jobLock;
    }

    @Scheduled(cron = "0 40 3 * * *", zone = "America/Argentina/Buenos_Aires")
    public void run() {
        jobLock.runExclusively(JobLock.Job.MAIL_RETENTION, () -> {
            try {
                retention.cleanup();
            } catch (RuntimeException e) {
                log.warn("Mail retention cleanup failed: {}", e.getMessage());
            }
        });
    }
}
