package org.ceitba.api.scheduling;

import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.service.kb.admin.KbModelCatalogService;
import org.ceitba.api.service.kb.eval.KbEvalService;
import org.ceitba.api.service.kb.pipeline.KbPipelineService;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
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

import java.util.UUID;

// Background side of the wiki pipeline (docs/SUBJECT-WIKI-PIPELINE.md, "Orchestration"):
//   - kick: a run/eval created, approved or resumed is advanced at once, on
//     the task executor, one task per run (a long sync stage of one run
//     never delays another); sync stages flow straight into the next stage
//   - batch poller, every KB_BATCH_POLL_INTERVAL (PT1M): only runs with a
//     SUBMITTED DO batch or a QUEUED one whose rate-limited creation is due
//     (nextAttemptAt), and pending batch probes (likewise)
//   - safety sweep, every KB_POLL_INTERVAL (PT10M): kicks every active run
//   - at startup: resumes every active run a restart interrupted, counting
//     the resumes of RUNNING ones (KbRunEngine.registerResume): a run resumed
//     more than 3 times in 30 minutes without finishing a stage is FAILED
//   - every minute: the weekly cron (only when enabled in the settings)
// Each run has one advancer at a time (KbRunEngine.advance, DB lease).
// Off with kb.pipeline.background=false (tests drive the engine directly).
@Component
@ConditionalOnProperty(name = "kb.pipeline.background", havingValue = "true", matchIfMissing = true)
public class KbPipelineJob {

    private static final Logger log = LoggerFactory.getLogger(KbPipelineJob.class);

    private final KbRunEngine engine;
    private final KbPipelineService pipeline;
    private final KbModelCatalogService catalog;
    private final KbEvalService evals;
    private final KbBatchJobRepository jobs;
    private final TaskExecutor executor;
    private final org.springframework.scheduling.TaskScheduler scheduler;
    private final java.time.Clock clock;
    private final JobLock jobLock;

    public KbPipelineJob(KbRunEngine engine, KbPipelineService pipeline, KbModelCatalogService catalog,
                         KbEvalService evals, KbBatchJobRepository jobs,
                         @Qualifier("applicationTaskExecutor") TaskExecutor executor,
                         org.springframework.scheduling.TaskScheduler scheduler, java.time.Clock clock,
                         JobLock jobLock) {
        this.clock = clock;
        this.jobLock = jobLock;
        this.scheduler = scheduler;
        this.engine = engine;
        this.pipeline = pipeline;
        this.catalog = catalog;
        this.evals = evals;
        this.jobs = jobs;
        this.executor = executor;
    }

    // Advances one run on the task executor. When another advancer holds the
    // run's lease (normally a live one, which loops again on its own; after a
    // restart possibly the dead process), try again once that lease can have
    // expired instead of waiting for the sweep.
    void kick(UUID runId) {
        executor.execute(() -> {
            try {
                if (!engine.advance(runId)) {
                    scheduler.schedule(() -> kick(runId),
                        java.time.Instant.now(clock).plus(KbRunEngine.LEASE).plusSeconds(5));
                }
            } catch (RuntimeException e) {
                log.warn("KB run {} could not be advanced now (the sweep retries): {}", runId, e.getMessage());
            }
        });
    }

    @TransactionalEventListener(fallbackExecution = true)
    public void onTriggered(KbPipelineService.RunTriggered event) {
        kick(event.runId());
    }

    @Scheduled(fixedDelayString = "${kb.pipeline.batch-poll-interval:PT1M}", initialDelayString = "PT30S")
    public void pollBatches() {
        jobLock.runExclusively(JobLock.Job.KB_PIPELINE_BATCHES, () -> {
            try {
                jobs.runsWithOpenBatches(java.time.OffsetDateTime.now(clock)).forEach(this::kick);
                engine.quotaResumeDue().forEach(this::kick);   // sync runs paused on the daily token quota
            } catch (RuntimeException e) {
                log.warn("KB batch poll failed: {}", e.getMessage());
            }
            try {
                catalog.refreshPendingProbes();
            } catch (RuntimeException e) {
                log.warn("KB probe refresh failed: {}", e.getMessage());
            }
        });
    }

    @Scheduled(fixedDelayString = "${kb.pipeline.poll-interval:PT10M}", initialDelayString = "${kb.pipeline.poll-interval:PT10M}")
    public void sweep() {
        jobLock.runExclusively(JobLock.Job.KB_PIPELINE_POLL, () -> {
            try {
                engine.activeRunIds().forEach(this::kick);
            } catch (RuntimeException e) {
                log.warn("KB pipeline sweep failed: {}", e.getMessage());
            }
        });
    }

    @Scheduled(cron = "0 * * * * *", zone = "America/Argentina/Buenos_Aires")
    public void tick() {
        jobLock.runExclusively(JobLock.Job.KB_PIPELINE_SCHEDULE, () -> {
            try {
                pipeline.schedulerTick();
            } catch (RuntimeException e) {
                log.warn("KB pipeline scheduler tick failed: {}", e.getMessage());
            }
        });
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        evals.ensureDefaultSet();
        // Resume runs a restart interrupted, but never one that keeps taking the
        // process down: after KbRunEngine.MAX_RESUMES startups inside the window
        // without finishing a stage the run is failed instead (e.g. out of memory).
        try {
            for (var id : engine.activeRunIds()) {
                if (engine.registerResume(id)) kick(id);
            }
        } catch (RuntimeException e) {
            log.warn("KB startup resume failed: {}", e.getMessage());
        }
    }
}
