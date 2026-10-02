package org.ceitba.api.scheduling;

import org.ceitba.api.service.kb.KbRelationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Keeps the subject wikis' "related subjects" in step with the plans: on
// startup and nightly at 04:30 (after the 00:00 ITBA sync).
@Component
public class KbRelationJob {

    private static final Logger log = LoggerFactory.getLogger(KbRelationJob.class);

    private final KbRelationService relations;

    public KbRelationJob(KbRelationService relations) {
        this.relations = relations;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(cron = "0 30 4 * * *")
    public void run() {
        try {
            log.info("KB subject relations refreshed: {} prerequisite pairs", relations.refresh());
        } catch (RuntimeException e) {
            log.warn("KB subject relation refresh failed: {}", e.getMessage());
        }
    }
}
