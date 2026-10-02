package org.ceitba.api.scheduling;

import org.ceitba.api.service.drive.DriveSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

// Periodic Drive sync (docs/DRIVE-SYNC.md). Off unless drive-sync.enabled.
// Fixed delay (DRIVE_SYNC_INTERVAL, ISO-8601) between the end of one run and
// the start of the next; each run stops at DRIVE_SYNC_RUN_BUDGET. The guard
// keeps a run from overlapping another (e.g. a manual invocation).
@Component
@ConditionalOnProperty(name = "drive-sync.enabled", havingValue = "true")
public class DriveSyncJob {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncJob.class);

    private final DriveSyncService driveSync;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public DriveSyncJob(DriveSyncService driveSync) {
        this.driveSync = driveSync;
    }

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "${drive-sync.interval:PT30M}")
    public void run() {
        if (!running.compareAndSet(false, true)) {
            log.info("Drive sync still running; skipping this tick");
            return;
        }
        try {
            driveSync.runAll();
        } catch (Exception e) {
            log.error("Scheduled Drive sync failed", e);
        } finally {
            running.set(false);
        }
    }
}
