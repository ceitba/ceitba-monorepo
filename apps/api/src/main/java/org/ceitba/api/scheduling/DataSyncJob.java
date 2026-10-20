package org.ceitba.api.scheduling;

import org.ceitba.api.service.sync.DataSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Twice-daily sync (00:00 and 12:00 server time). Disabled by default in
// non-prod; enable with sync.enabled=true. Cron uses Spring's six-field
// format (sec/min/hour/dom/mon/dow) — NOT five-field Unix.
@Component
@ConditionalOnProperty(name = "sync.enabled", havingValue = "true")
public class DataSyncJob {

    private static final Logger log = LoggerFactory.getLogger(DataSyncJob.class);

    private final DataSyncService dataSyncService;
    private final JobLock jobLock;

    public DataSyncJob(DataSyncService dataSyncService, JobLock jobLock) {
        this.dataSyncService = dataSyncService;
        this.jobLock = jobLock;
    }

    @Scheduled(cron = "0 0 0,12 * * *")
    public void run() {
        jobLock.runExclusively(JobLock.Job.DATA_SYNC, () -> {
            try {
                var result = dataSyncService.syncAll(null);
                log.info("Scheduled sync done: subjects={}/{}/{} plans={}/{}/{} commissions={}/{}/{}",
                    result.subjects().getCreated(), result.subjects().getUpdated(), result.subjects().getErrors(),
                    result.subjectPlans().getCreated(), result.subjectPlans().getUpdated(), result.subjectPlans().getErrors(),
                    result.commissions().getCreated(), result.commissions().getUpdated(), result.commissions().getErrors());
            } catch (Exception e) {
                log.error("Scheduled sync failed", e);
            }
        });
    }
}
