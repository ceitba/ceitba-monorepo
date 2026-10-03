package org.ceitba.api.service.drive;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

// Runs a requested sync once the request's transaction committed, so the
// request never waits on Drive. Syncs run on their own small bounded pool
// (THREADS workers, QUEUE_CAPACITY waiting), not on Boot's shared
// applicationTaskExecutor: a staff reprocess queues one sync per source and
// must not starve pushes or the wiki pipeline. When the queue is full the
// request is dropped (logged); the scheduled DriveSyncJob syncs it later.
// Not an Executor bean on purpose: one would replace Boot's default executor
// (see PushConfig).
@Component
public class DriveSyncTrigger {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncTrigger.class);

    static final int THREADS = 2;
    static final int QUEUE_CAPACITY = 500;

    private final DriveSyncService sync;
    private final ThreadPoolExecutor executor;

    public DriveSyncTrigger(DriveSyncService sync) {
        this.sync = sync;
        var n = new AtomicInteger();
        this.executor = new ThreadPoolExecutor(THREADS, THREADS, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(QUEUE_CAPACITY), r -> {
                var t = new Thread(r, "drive-sync-" + n.incrementAndGet());
                t.setDaemon(true);
                return t;
            });
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void on(DriveSyncRequested event) {
        try {
            executor.execute(() -> run(event));
        } catch (RejectedExecutionException e) {
            log.warn("Drive sync queue full; requested sync of {} left to the scheduled run", event.sourceId());
        }
    }

    private void run(DriveSyncRequested event) {
        try {
            var outcome = sync.syncSource(event.sourceId());
            log.debug("Requested Drive sync of {}: {}", event.sourceId(), outcome);
        } catch (RuntimeException e) {
            log.error("Requested Drive sync of {} failed", event.sourceId(), e);
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
