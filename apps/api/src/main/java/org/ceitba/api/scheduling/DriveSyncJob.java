package org.ceitba.api.scheduling;

import org.ceitba.api.service.drive.DriveSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Periodic Drive sync (docs/DRIVE-SYNC.md). Off unless drive-sync.enabled.
// Fixed delay (DRIVE_SYNC_INTERVAL, ISO-8601) between the end of one run and
// the start of the next; each run stops at DRIVE_SYNC_RUN_BUDGET. JobLock keeps
// a run from overlapping another one, in this process or another.
@Component
@ConditionalOnProperty(name = "drive-sync.enabled", havingValue = "true")
public class DriveSyncJob {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncJob.class);

    private final DriveSyncService driveSync;
    private final JobLock jobLock;

    public DriveSyncJob(DriveSyncService driveSync, JobLock jobLock) {
        this.driveSync = driveSync;
        this.jobLock = jobLock;
    }

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "${drive-sync.interval:PT30M}")
    public void run() {
        jobLock.runExclusively(JobLock.Job.DRIVE_SYNC, () -> {
            try {
                driveSync.runAll();
            } catch (Exception e) {
                log.error("Scheduled Drive sync failed", e);
            }
        });
    }
}
