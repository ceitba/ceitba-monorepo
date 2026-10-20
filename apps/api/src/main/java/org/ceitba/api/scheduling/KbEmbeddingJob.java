package org.ceitba.api.scheduling;

import org.ceitba.api.service.kb.KbEmbeddingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Keeps the wiki pages' embeddings current (KbEmbeddingService): a sweep a
// minute after startup and then every kb.embeddings.interval. Pages written
// by an import or a pipeline run are embedded by the next sweep. Off with
// kb.embeddings.enabled=false (tests); a no-op while embeddings are unconfigured.
@Component
@ConditionalOnProperty(name = "kb.embeddings.enabled", havingValue = "true", matchIfMissing = true)
public class KbEmbeddingJob {

    private static final Logger log = LoggerFactory.getLogger(KbEmbeddingJob.class);

    private final KbEmbeddingService embeddings;
    private final JobLock jobLock;

    public KbEmbeddingJob(KbEmbeddingService embeddings, JobLock jobLock) {
        this.embeddings = embeddings;
        this.jobLock = jobLock;
    }

    @Scheduled(fixedDelayString = "${kb.embeddings.interval:PT5M}", initialDelayString = "PT1M")
    public void run() {
        jobLock.runExclusively(JobLock.Job.KB_EMBEDDINGS, () -> {
            try {
                embeddings.embedPending();
            } catch (RuntimeException e) {
                log.warn("KB embedding sweep failed: {}", e.getMessage());
            }
        });
    }
}
