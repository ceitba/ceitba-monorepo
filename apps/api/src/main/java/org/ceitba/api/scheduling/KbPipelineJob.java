package org.ceitba.api.scheduling;

import org.ceitba.api.service.kb.admin.KbModelCatalogService;
import org.ceitba.api.service.kb.eval.KbEvalService;
import org.ceitba.api.service.kb.pipeline.KbPipelineService;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

// Background side of the wiki pipeline (docs/SUBJECT-WIKI-PIPELINE.md):
//   - every KB_POLL_INTERVAL: advance active runs and evals (poll batches,
//     resume sync jobs), refresh pending batch probes; always on, so manual
//     runs and evals progress even with KB_PIPELINE_ENABLED=false
//   - every minute: start the weekly run when the cron is due (only when
//     enabled in the settings)
//   - right after a run/eval is triggered: advance it without waiting for
//     the poller (async, after the trigger's transaction commits)
// Off with kb.pipeline.background=false (tests drive the engine directly).
@Component
@ConditionalOnProperty(name = "kb.pipeline.background", havingValue = "true", matchIfMissing = true)
public class KbPipelineJob {

    private static final Logger log = LoggerFactory.getLogger(KbPipelineJob.class);

    private final KbRunEngine engine;
    private final KbPipelineService pipeline;
    private final KbModelCatalogService catalog;
    private final KbEvalService evals;

    public KbPipelineJob(KbRunEngine engine, KbPipelineService pipeline, KbModelCatalogService catalog,
                         KbEvalService evals) {
        this.engine = engine;
        this.pipeline = pipeline;
        this.catalog = catalog;
        this.evals = evals;
    }

    @Scheduled(fixedDelayString = "${kb.pipeline.poll-interval:PT10M}", initialDelayString = "PT1M")
    public void poll() {
        try {
            engine.advanceActive();
        } catch (RuntimeException e) {
            log.warn("KB pipeline poll failed: {}", e.getMessage());
        }
        try {
            catalog.refreshPendingProbes();
        } catch (RuntimeException e) {
            log.warn("KB probe refresh failed: {}", e.getMessage());
        }
    }

    @Scheduled(cron = "0 * * * * *", zone = "America/Argentina/Buenos_Aires")
    public void tick() {
        try {
            pipeline.schedulerTick();
        } catch (RuntimeException e) {
            log.warn("KB pipeline scheduler tick failed: {}", e.getMessage());
        }
    }

    @Async("applicationTaskExecutor")
    @TransactionalEventListener(fallbackExecution = true)
    public void onTriggered(KbPipelineService.RunTriggered event) {
        try {
            engine.advanceActive();
        } catch (RuntimeException e) {
            log.warn("KB run {} could not be advanced now (the poller retries): {}", event.runId(), e.getMessage());
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seedDefaultEvalSet() {
        evals.ensureDefaultSet();
    }
}
