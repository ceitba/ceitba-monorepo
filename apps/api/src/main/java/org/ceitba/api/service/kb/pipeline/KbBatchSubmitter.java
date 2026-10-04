package org.ceitba.api.service.kb.pipeline;

import org.ceitba.api.domain.kb.KbBatchJob;
import org.ceitba.api.external.llm.DoBatchErrors;
import org.ceitba.api.external.llm.DoBatchSlotException;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Idempotent DO batch submission (docs/SUBJECT-WIKI-PIPELINE.md, "Batch
// submission"):
//   1. queue(): the kb_batch_job row (QUEUED) and its requests are written in
//      their own transaction BEFORE DO is called; the unique index on (run,
//      stage, attempt, model) makes a second advancer find the row and never
//      submit again.
//   2. submitQueued(): creates the DO batch with the deterministic request_id
//      <runId>:<stage>:<attempt>:<model>. A 429 (or no response / 5xx) keeps
//      the job QUEUED with nextAttemptAt (1, 5, 15, 60 min, then hourly); the
//      poller retries it when due. Before re-creating after a failure, DO's
//      batch list is checked for that request_id. Any other refusal fails the
//      job (and its requests) with DO's message: there is no fallback to sync.
// Callers hold the run's lease (KbRunEngine.advance).
@Component
public class KbBatchSubmitter {

    private static final Logger log = LoggerFactory.getLogger(KbBatchSubmitter.class);

    static final List<Duration> BACKOFF = List.of(Duration.ofMinutes(1), Duration.ofMinutes(5),
        Duration.ofMinutes(15), Duration.ofMinutes(60));

    // Prefix of the job error while waiting for a batch slot (progress shows it).
    public static final String QUOTA_WAIT = "QUOTA_WAIT: ";

    public enum Outcome { SUBMITTED, WAITING, FAILED }

    private final KbBatchJobRepository jobs;
    private final KbRunRequestRepository requests;
    private final KbRunRepository runs;
    private final BatchLlmExecutor batch;
    private final KbLlmRouter router;
    private final TransactionTemplate tx;
    private final Clock clock;

    public KbBatchSubmitter(KbBatchJobRepository jobs, KbRunRequestRepository requests, KbRunRepository runs,
                            BatchLlmExecutor batch, KbLlmRouter router, TransactionTemplate tx, Clock clock) {
        this.jobs = jobs;
        this.requests = requests;
        this.runs = runs;
        this.batch = batch;
        this.router = router;
        this.tx = tx;
        this.clock = clock;
    }

    // Wait before the n-th retry of a refused creation (n = failures so far, 1-based).
    public static Duration backoff(int failures) {
        return BACKOFF.get(Math.max(0, Math.min(failures, BACKOFF.size()) - 1));
    }

    public static String requestId(UUID runId, String stage, int attempt, String model) {
        return runId + ":" + stage + ":" + attempt + ":" + model;
    }

    // The QUEUED job of (run, stage, attempt, model) with its requests
    // attached; null when that row already exists (queued by someone else:
    // nothing to submit).
    public KbBatchJob queue(UUID runId, String stage, int attempt, String model, List<String> customIds,
                            String payloadKey) {
        try {
            return tx.execute(s -> {
                var job = new KbBatchJob(runId, stage, attempt, model, "BATCH", customIds.size(), payloadKey);
                job.queued(requestId(runId, stage, attempt, model));
                var saved = jobs.saveAndFlush(job);
                requests.findAllById(customIds).forEach(r -> r.submitted(saved.getId()));
                return saved;
            });
        } catch (DataIntegrityViolationException e) {
            log.warn("KB run {} {} attempt {} ({}) is already queued; not submitting again", runId, stage, attempt,
                model);
            return null;
        }
    }

    // Creates the DO batch of a QUEUED job when it is due.
    public Outcome submitQueued(UUID jobId) {
        var job = tx.execute(s -> jobs.findById(jobId).orElseThrow());
        if (job.getStatus().equals("SUBMITTED")) return Outcome.SUBMITTED;
        if (!job.getStatus().equals("QUEUED")) return Outcome.FAILED;
        var now = now();
        if (job.getNextAttemptAt() != null && now.isBefore(job.getNextAttemptAt())) return Outcome.WAITING;
        var requestId = job.getDoRequestId() != null ? job.getDoRequestId()
            : requestId(job.getRunId(), job.getStage(), job.getAttempt(), job.getModel());
        if (job.getSubmitFailures() > 0) {
            // A creation that got no clear answer may have gone through.
            try {
                var existing = batch.findByRequestId(requestId);
                if (existing.isPresent() && existing.get().id() != null) {
                    markSubmitted(job, null, existing.get().id());
                    return Outcome.SUBMITTED;
                }
            } catch (LlmApiException e) {
                log.debug("KB batch list unavailable: {}", e.getMessage());
            }
        }
        var lines = tx.execute(s -> requests.findByBatchJobId(jobId).stream()
            .filter(r -> r.getStatus().equals("SUBMITTED"))
            .map(r -> new LlmLine(r.getCustomId(), r.getParams())).toList());
        if (lines.isEmpty()) {
            tx.executeWithoutResult(s -> jobs.findById(jobId).orElseThrow().finish("FAILED", null, now(),
                "no requests to submit"));
            return Outcome.FAILED;
        }
        try {
            var submitted = batch.submit(job.getPayloadKey().replace('/', '_'), job.getModel(),
                router.batchModelId(job.getModel()), lines, requestId);
            markSubmitted(job, submitted.fileId(), submitted.batchId());
            log.info("KB run {} {} batch {} submitted ({} requests, {})", job.getRunId(), job.getStage(),
                submitted.batchId(), lines.size(), job.getModel());
            return Outcome.SUBMITTED;
        } catch (LlmApiException e) {
            var kind = DoBatchErrors.classify(e.status(), e.getMessage());
            if (kind == DoBatchErrors.Kind.RATE_LIMITED || kind == DoBatchErrors.Kind.TRANSIENT) {
                // A snapshot-based wait (no DO call made) has its own time and message.
                var slot = e instanceof DoBatchSlotException x ? x : null;
                var at = slot != null ? slot.retryAt() : now().plus(backoff(job.getSubmitFailures() + 1));
                tx.executeWithoutResult(s -> {
                    jobs.findById(jobId).orElseThrow().retryAt(at, slot != null ? QUOTA_WAIT + slot.getMessage()
                        .replace(" (rate_limit_exceeded)", "") : (kind == DoBatchErrors.Kind.RATE_LIMITED
                        ? "RATE_LIMITED: " : "UNAVAILABLE: ") + e.getMessage());
                    runs.setStatusIf(job.getRunId(), "WAITING", KbRunEngine.MOVING);
                });
                log.warn("KB run {} {} batch creation refused ({}); retry at {}", job.getRunId(), job.getStage(),
                    e.getMessage(), at);
                return Outcome.WAITING;
            }
            var error = "DigitalOcean rejected the batch: " + e.getMessage();
            tx.executeWithoutResult(s -> {
                jobs.findById(jobId).orElseThrow().finish("FAILED", null, now(), error);
                requests.findByBatchJobId(jobId).stream().filter(r -> r.getStatus().equals("SUBMITTED"))
                    .forEach(r -> r.failed(error));
            });
            log.warn("KB run {} {} batch rejected: {}", job.getRunId(), job.getStage(), e.getMessage());
            return Outcome.FAILED;
        }
    }

    private void markSubmitted(KbBatchJob job, String fileId, String batchId) {
        tx.executeWithoutResult(s -> {
            jobs.findById(job.getId()).orElseThrow().submitted(fileId, batchId, now());
            // Conditional: a cancel that landed during the HTTP call sticks.
            runs.setStatusIf(job.getRunId(), "RUNNING", KbRunEngine.MOVING);
        });
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }
}
