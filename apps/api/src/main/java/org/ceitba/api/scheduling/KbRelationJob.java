package org.ceitba.api.scheduling;

import org.ceitba.api.service.kb.KbRelationService;
import org.ceitba.api.service.kb.KbRunRetentionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Keeps the subject wikis' "related subjects" in step with the plans: on
// startup and nightly at 04:30 (after the 00:00 ITBA sync). The same nightly
// tick expires the pipeline's stored payloads (KbRunRetentionService).
@Component
public class KbRelationJob {

    private static final Logger log = LoggerFactory.getLogger(KbRelationJob.class);

    private final KbRelationService relations;
    private final KbRunRetentionService retention;
    private final JobLock jobLock;

    public KbRelationJob(KbRelationService relations, KbRunRetentionService retention, JobLock jobLock) {
        this.relations = relations;
        this.retention = retention;
        this.jobLock = jobLock;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(cron = "0 30 4 * * *")
    public void run() {
        jobLock.runExclusively(JobLock.Job.KB_RELATIONS, () -> {
            try {
                log.info("KB subject relations refreshed: {} prerequisite pairs", relations.refresh());
            } catch (RuntimeException e) {
                log.warn("KB subject relation refresh failed: {}", e.getMessage());
            }
            try {
                retention.purgeExpired();
            } catch (RuntimeException e) {
                log.warn("KB run retention failed: {}", e.getMessage());
            }
        });
    }
}
