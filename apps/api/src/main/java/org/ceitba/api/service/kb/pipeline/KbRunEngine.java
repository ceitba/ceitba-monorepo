package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.kb.KbBatchJob;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.domain.kb.KbRunRequest;
import org.ceitba.api.domain.kb.KbRunSubjectId;
import org.ceitba.api.external.llm.DoBatchErrors;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.LlmOutputParser;
import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.repository.kb.KbRunSubjectRepository;
import org.ceitba.api.service.kb.admin.KbCostService;
import org.ceitba.api.service.kb.admin.KbSettingsService;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbUsageRecorder;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.ceitba.api.external.llm.DoQuotaTracker;
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
import org.ceitba.api.service.media.ObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

// Runs the stages of pipeline runs and evaluations (KbRunHandler), kept
// entirely in the database so a restart resumes where it stopped:
//
//   build requests (budget/cost limit) -> store the canonical JSONL in
//   storage (kb/runs/<runId>/<stage>[-<attempt>][-<n>].jsonl, same in both
//   modes) -> execute per model, BATCH (DO batch, polled) or SYNC (chat
//   completions, each result persisted as it arrives) -> record every
//   result (request row, kb_llm_usage with its frozen cost, run/stage/
//   subject totals) -> resubmit once what got no answer -> handler.after.
//
// The mode is chosen per model at submission from the runtime settings, so
// a settings change applies to the next stage, never to one in flight.
@Service
public class KbRunEngine {

    private static final Logger log = LoggerFactory.getLogger(KbRunEngine.class);

    public static final List<String> ACTIVE = List.of("RUNNING", "WAITING", "BLOCKED_BY_COST_LIMIT");
    // Statuses a RUNNING <-> WAITING toggle may move from.
    static final List<String> MOVING = List.of("RUNNING", "WAITING");
    static final List<String> LLM_STAGES = List.of("DIGEST", "PLAN", "WRITE", "RETRY");
    static final int MAX_STEPS = 200;
    static final int JSONL_PAGE = 50;
    // Requests loaded per page wherever a stage's requests are walked (ids
    // first, then rows in pages that are detached once handled).
    static final int PAGE = 200;
    // Restart-loop guard: a RUNNING run resumed by more than MAX_RESUMES
    // startups inside RESUME_WINDOW, without finishing a stage, is failed.
    public static final int MAX_RESUMES = 3;
    public static final java.time.Duration RESUME_WINDOW = java.time.Duration.ofMinutes(30);
    public static final String RESUME_LOOP_ERROR = "detenida tras reinicios repetidos (posible falta de memoria)";

    private final KbRunRepository runs;
    private final KbBatchJobRepository jobs;
    private final KbRunRequestRepository requests;
    private final KbRunSubjectRepository runSubjects;
    private final List<KbRunHandler> handlers;
    private final KbLlmRouter router;
    private final BatchLlmExecutor batch;
    private final KbBatchSubmitter submitter;
    private final SyncLlmExecutor sync;
    private final KbUsageRecorder usage;
    private final KbSettingsService settings;
    private final KbCostService costs;
    private final ObjectStorage storage;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;
    // Per run: "advance again" requests that arrived while it was advancing.
    private final java.util.concurrent.ConcurrentHashMap<UUID, AtomicBoolean> again =
        new java.util.concurrent.ConcurrentHashMap<>();
    static final String QUOTA_PAUSE_PREFIX = "Cupo diario";
    static final String QUOTA_PAUSE = "Cupo diario de tokens de DigitalOcean agotado; reintento a las ";
    // Runs paused on the daily token quota -> when to try again (in memory:
    // after a restart the first request finds out again).
    private final java.util.concurrent.ConcurrentHashMap<UUID, OffsetDateTime> quotaPausedUntil =
        new java.util.concurrent.ConcurrentHashMap<>();
    public static final java.time.Duration LEASE = java.time.Duration.ofMinutes(3);
    static final java.time.Duration CANCEL_CHECK = java.time.Duration.ofSeconds(5);
    static final java.time.Duration LEASE_RENEW = java.time.Duration.ofSeconds(60);
    // Not `synchronized`: on Java 21 a virtual thread blocked on a monitor pins
    // its carrier, and with the sync workers queued here every carrier was
    // pinned while other workers sat mid-transaction: the pool ran dry.
    private final java.util.concurrent.locks.ReentrantLock recordLock = new java.util.concurrent.locks.ReentrantLock();

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager em;

    public KbRunEngine(KbRunRepository runs, KbBatchJobRepository jobs, KbRunRequestRepository requests,
                       KbRunSubjectRepository runSubjects, @Lazy List<KbRunHandler> handlers, KbLlmRouter router,
                       BatchLlmExecutor batch, KbBatchSubmitter submitter, SyncLlmExecutor sync, KbUsageRecorder usage,
                       KbSettingsService settings, KbCostService costs, ObjectStorage storage,
                       TransactionTemplate tx, ObjectMapper json, Clock clock) {
        this.runs = runs;
        this.jobs = jobs;
        this.requests = requests;
        this.runSubjects = runSubjects;
        this.handlers = handlers;
        this.router = router;
        this.batch = batch;
        this.submitter = submitter;
        this.sync = sync;
        this.usage = usage;
        this.settings = settings;
        this.costs = costs;
        this.storage = storage;
        this.tx = tx;
        this.json = json;
        this.clock = clock;
    }

    // Sequence for custom ids within a run.
    public static final class Seq {
        private int value;

        Seq(int start) {
            this.value = start;
        }

        int next() {
            return ++value;
        }
    }

    // ==== driving runs ===========================================================

    // Advances every active run (synchronously, one after another): tests
    // and the safety sweep's fallback. Normally runs are advanced one by one
    // through advance(runId) on the task executor (KbPipelineJob).
    public void advanceActive() {
        for (var id : activeRunIds()) advance(id);
    }

    // Startup resume of an active run (KbPipelineJob.onStartup). A RUNNING run
    // (one that was advancing a stage when the process stopped) counts one
    // resume; more than MAX_RESUMES inside RESUME_WINDOW without a stage
    // finishing means the stage takes the process down (e.g. out of memory),
    // so the run is FAILED instead of resumed into another crash. Runs that
    // wait (WAITING on a batch or the daily quota, BLOCKED) are not counted.
    // False when the run must not be resumed.
    public boolean registerResume(UUID runId) {
        return inTx(() -> {
            var run = runs.lockById(runId).orElse(null);
            if (run == null || !run.isActive()) return false;
            if (!run.getStatus().equals("RUNNING")) return true;
            runs.countResume(runId, now(), now().minus(RESUME_WINDOW));
            int n = runs.resumeCount(runId);
            if (n <= MAX_RESUMES) {
                log.warn("KB run {} resumed after a restart ({} of {} allowed within {})", runId, n, MAX_RESUMES,
                    RESUME_WINDOW);
                return true;
            }
            log.error("KB run {} failed: {} startups in {} without finishing {} stage", runId, n, RESUME_WINDOW,
                run.getStage());
            run.setError(RESUME_LOOP_ERROR + " (" + run.getStage() + ")");
            for (var s : runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId)) {
                if (s.isActive()) s.fail(RESUME_LOOP_ERROR);
            }
            run.finish("FAILED", now());
            return false;
        });
    }

    public List<UUID> activeRunIds() {
        return inTx(() -> runs.findByStatusIn(ACTIVE).stream().map(KbRun::getId).toList());
    }

    // Advances one run as far as it can go now (through sync stages and the
    // code-only steps; stops when it waits for a batch or ends). One advancer
    // per run: a DB lease (V37, renewed every minute while advancing); a call
    // that finds the run busy only asks the holder to loop once more, so a
    // kick is never lost. False when another advancer holds the run.
    public boolean advance(UUID runId) {
        var flag = again.computeIfAbsent(runId, k -> new AtomicBoolean());
        flag.set(true);
        var token = UUID.randomUUID().toString();
        if (!takeLease(runId, token)) return false;
        var heartbeat = Thread.ofVirtual().start(() -> {
            try {
                while (!Thread.currentThread().isInterrupted()) {
                    Thread.sleep(LEASE_RENEW.toMillis());
                    takeLease(runId, token);
                }
            } catch (InterruptedException ignored) {
                // done
            }
        });
        try {
            while (flag.getAndSet(false)) {
                for (int i = 0; i < MAX_STEPS && step(runId); i++) {
                    // keep going
                }
            }
        } finally {
            heartbeat.interrupt();
            inTxVoid(() -> runs.releaseLease(runId, token));
        }
        if (flag.get()) return advance(runId);   // a kick arrived while releasing
        again.remove(runId, flag);
        return true;
    }

    private boolean takeLease(UUID runId, String token) {
        var now = now();
        return inTx(() -> runs.takeLease(runId, token, now.plus(LEASE), now)) == 1;
    }

    // One transition; false when the run has to wait (or is over/blocked).
    // Stage changes are written to kb_run.stage_log and logged once (INFO).
    public boolean step(UUID runId) {
        var before = inTx(() -> runs.findById(runId).map(r -> r.getStage() + "|" + r.getStatus()).orElse(null));
        var moved = stepOnce(runId);
        if (before != null) transitions(runId, before.split("\\|")[0], before.split("\\|")[1]);
        return moved;
    }

    private void transitions(UUID runId, String stageBefore, String statusBefore) {
        inTxVoid(() -> {
            var r = runs.findById(runId).orElse(null);
            if (r == null) return;
            boolean stageChanged = !r.getStage().equals(stageBefore);
            boolean ended = !r.isActive() && !statusBefore.equals(r.getStatus());
            if (!stageChanged && !ended) return;
            if (stageChanged) runs.resetResumes(runId);   // progress: earlier restarts no longer count
            var at = now().toString();
            var logNode = r.getStageLog() == null ? json.createObjectNode() : (ObjectNode) r.getStageLog().deepCopy();
            var prev = logNode.with(stageBefore);
            if (!prev.has("startedAt")) prev.put("startedAt", r.getStartedAt() == null ? at : r.getStartedAt().toString());
            prev.put("finishedAt", at);
            if (stageChanged && !r.getStage().equals("DONE")) logNode.with(r.getStage()).put("startedAt", at);
            r.setStageLog(logNode);
            long total = requests.countByRunIdAndStage(runId, stageBefore);
            long done = requests.countByRunIdAndStageAndStatus(runId, stageBefore, "DONE");
            long failed = requests.countByRunIdAndStageAndStatus(runId, stageBefore, "FAILED");
            log.info("KB {} {}: {} -> {} ({}; {} requests: {} done, {} failed)", r.isEval() ? "eval" : "run", runId,
                stageBefore, r.getStage(), r.getStatus(), total, done, failed);
        });
    }

    private boolean stepOnce(UUID runId) {
        var run = inTx(() -> runs.findById(runId).orElse(null));
        if (run == null || !run.isActive() || run.getStatus().equals("BLOCKED_BY_COST_LIMIT")) return false;
        var handler = handler(run);
        try {
            if (run.getStage().equals("DETECT")) {
                return whileActive(runId, handler::detect);
            }
            if (LLM_STAGES.contains(run.getStage())) return llmStage(runId, run.getStage(), run.isDryRun(), handler);
            if (run.getStage().equals("DONE")) return false;
            handler.complete(runId);
            return true;
        } catch (LlmApiException e) {
            // The provider is unreachable or refusing: try again on the next poll.
            log.warn("KB run {} at {}: {}", runId, run.getStage(), e.getMessage());
            inTxVoid(() -> runs.findById(runId).ifPresent(r -> r.setError("LLM API: " + e.getMessage())));
            return false;
        } catch (RuntimeException e) {
            log.error("KB run {} failed at {}", runId, run.getStage(), e);
            inTxVoid(() -> runs.lockById(runId).filter(KbRun::isActive).ifPresent(r -> {
                r.setError(e.getClass().getSimpleName() + ": " + e.getMessage());
                for (var s : runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId)) {
                    if (s.isActive()) s.fail("run failed at " + r.getStage());
                }
                r.finish("FAILED", now());
            }));
            return false;
        }
    }

    public KbRun cancel(UUID runId) {
        var run = inTx(() -> runs.findById(runId).orElseThrow(() -> new ResourceNotFoundException("KbRun", runId.toString())));
        if (!run.isActive()) {
            throw new KbPipelineException(KbPipelineException.Reason.RUN_NOT_ACTIVE, "The run is not active");
        }
        for (var j : inTx(() -> jobs.findByRunIdOrderByCreatedAtAsc(runId))) {
            if (!j.getStatus().equals("SUBMITTED") || j.getDoBatchId() == null) continue;
            try {
                batch.cancel(j.getDoBatchId());
            } catch (LlmApiException e) {
                log.warn("KB run {}: cancelling batch {} failed: {}", runId, j.getDoBatchId(), e.getMessage());
            }
        }
        // Row-locked: a stage finishing or a subject publishing right now
        // completes first, and whatever comes after sees CANCELLED.
        return inTx(() -> {
            var r = runs.lockById(runId).orElseThrow();
            if (!r.isActive()) return r;   // it ended while the batches were being cancelled
            for (var j : jobs.findByRunIdOrderByCreatedAtAsc(runId)) {
                if (j.getStatus().equals("SUBMITTED") || j.getStatus().equals("QUEUED")) j.setStatus("CANCELLED");
            }
            for (var s : runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId)) {
                if (s.isActive()) s.setStatus("CANCELLED");
            }
            r.finish("CANCELLED", now());
            return r;
        });
    }

    // Staff accept a run blocked by the weekly cost limit (once).
    public KbRun approveCost(UUID runId) {
        return inTx(() -> {
            var r = runs.lockById(runId).orElseThrow(() -> new ResourceNotFoundException("KbRun", runId.toString()));
            if (!r.getStatus().equals("BLOCKED_BY_COST_LIMIT")) {
                throw new KbPipelineException(KbPipelineException.Reason.RUN_NOT_BLOCKED,
                    "The run is not blocked by the cost limit");
            }
            r.setCostApproved(true);
            r.setStatus("RUNNING");
            r.setError(null);
            return r;
        });
    }

    // ==== stages ===================================================================

    private boolean llmStage(UUID runId, String stage, boolean dry, KbRunHandler handler) {
        var stageJobs = inTx(() -> jobs.findByRunIdAndStage(runId, stage));
        if (stageJobs.isEmpty()) {
            long pending = inTx(() -> requests.countByRunIdAndStageAndStatusIn(runId, stage, List.of("PENDING")));
            if (pending == 0) {
                int built = inTx(() -> {
                    var r = runs.lockById(runId).orElseThrow();
                    return r.isActive() ? handler.build(r, stage, new Seq((int) requests.countByRunId(runId))) : -1;
                });
                if (built < 0) return false;
                if (built == 0) return whileActive(runId, r -> handler.after(r, stage));
            }
            if (!dry && handler.costLimited() && blockedByCost(runId, stage)) return false;
            submit(runId, stage, 1, dry);
            return true;
        }
        var open = stageJobs.stream().filter(j -> j.getStatus().equals("SUBMITTED") || j.getStatus().equals("QUEUED"))
            .toList();
        if (!open.isEmpty()) {
            boolean allDone = true;
            // Sync jobs (one per model) resume together, sharing the concurrency.
            var openSync = open.stream().filter(j -> j.getMode().equals("SYNC") && j.getStatus().equals("SUBMITTED"))
                .map(KbBatchJob::getId).toList();
            if (!openSync.isEmpty() && (quotaPaused(runId) || runSyncJobs(openSync))) allDone = false;
            for (var job : open) {
                if (job.getMode().equals("SYNC")) continue;
                if (job.getStatus().equals("QUEUED")) {
                    // Created before DO was called; a refused creation waits for nextAttemptAt.
                    var outcome = submitter.submitQueued(job.getId());
                    if (outcome != KbBatchSubmitter.Outcome.FAILED) allDone = false;
                    continue;
                }
                var info = batch.poll(job.getDoBatchId());
                observe(job.getId(), info);
                if (info.finished()) collectBatch(job.getId(), info);
                else allDone = false;
            }
            if (!allDone) {
                inTxVoid(() -> runs.setStatusIf(runId, "WAITING", MOVING));
                return false;
            }
            return true;
        }
        if (dry) return whileActive(runId, r -> handler.after(r, stage));
        int maxAttempt = stageJobs.stream().mapToInt(KbBatchJob::getAttempt).max().orElse(1);
        var syncJobs = stageJobs.stream().filter(j -> j.getMode().equals("SYNC")).map(KbBatchJob::getId).toList();
        var leftover = inTx(() -> {
            var ids = new ArrayList<String>();
            forPages(requests.idsByRunStageStatus(runId, stage, List.of("SUBMITTED", "PENDING")), rows -> {
                for (var r : rows) {
                    // Sync already retried empty/truncated answers with double max_tokens.
                    if (syncJobs.contains(r.getBatchJobId()) && emptyOrTruncated(r.getError())) {
                        r.failed(r.getError());
                        continue;
                    }
                    ids.add(r.getCustomId());
                }
            });
            // Answered but unusable (e.g. a PLAN whose operations were all
            // dropped): sent once more with the second attempt.
            if (maxAttempt < 2) {
                runs.findById(runId).filter(KbRun::isActive).ifPresent(r -> ids.addAll(handler.redo(r, stage)));
            }
            return ids;
        });
        if (!leftover.isEmpty() && maxAttempt < 2) {
            if (handler.costLimited() && blockedByCost(runId, stage, leftover)) return false;
            inTxVoid(() -> forPages(leftover, rows -> rows.forEach(r -> {
                if (emptyOrTruncated(r.getError())) r.doubleMaxTokens(SyncLlmExecutor.MAX_TOKENS_CAP);
                r.setStatus("PENDING");
            })));
            submit(runId, stage, maxAttempt + 1, false);
            return true;
        }
        return whileActive(runId, r -> {
            forPages(leftover, rows -> rows.forEach(q -> q.failed(q.getError() == null
                ? "no answer after resubmission" : q.getError())));
            handler.after(r, stage);
        });
    }

    // Walks requests by custom id, PAGE rows at a time: each page is loaded,
    // handled, flushed and detached before the next, so a stage of any size
    // costs one page of params in memory. Inside a transaction.
    void forPages(List<String> ids, java.util.function.Consumer<List<KbRunRequest>> work) {
        for (int i = 0; i < ids.size(); i += PAGE) {
            var rows = requests.findAllById(ids.subList(i, Math.min(ids.size(), i + PAGE)));
            work.accept(rows);
            em.flush();
            rows.forEach(em::detach);
        }
    }

    // Runs `work` on the row-locked run if it is still active (a cancel
    // that committed meanwhile wins); false when it is not.
    private boolean whileActive(UUID runId, java.util.function.Consumer<KbRun> work) {
        return inTx(() -> {
            var r = runs.lockById(runId).orElse(null);
            if (r == null || !r.isActive()) return false;
            work.accept(r);
            return true;
        });
    }

    // Weekly cost limit, checked before every submission (first attempt and
    // resubmission of each stage): everything recorded in kb_llm_usage over
    // the last 7 days (this run's answers included) plus the estimate of the
    // requests about to go out (`only`: those custom ids, else the stage's
    // PENDING ones). An approved run is not checked again.
    private boolean blockedByCost(UUID runId, String stage) {
        return blockedByCost(runId, stage, null);
    }

    private boolean blockedByCost(UUID runId, String stage, List<String> only) {
        var limit = settings.effective().weeklyCostLimitUsd();
        if (limit == null) return false;
        return inTx(() -> {
            var run = runs.lockById(runId).orElseThrow();
            if (run.isCostApproved() || !run.isActive()) return false;
            var mode = settings.effective().executionMode();
            var spent = costs.spentSince(now().minusDays(7));
            var estimate = BigDecimal.ZERO;
            // Per model, summed in SQL: no request (or its params) is loaded.
            var perModel = new ArrayList<Object[]>();
            if (only == null) perModel.addAll(requests.pendingEstimate(runId, stage));
            else for (int i = 0; i < only.size(); i += 1000) {
                perModel.addAll(requests.estimateOf(only.subList(i, Math.min(only.size(), i + 1000))));
            }
            for (var row : perModel) {
                var model = (String) row[0];
                estimate = estimate.add(costs.estimate(model, router.modeFor(model, mode),
                    ((Number) row[1]).longValue(), ((Number) row[2]).longValue()));
            }
            var total = spent.add(estimate);
            if (total.compareTo(limit) <= 0) return false;
            run.setStatus("BLOCKED_BY_COST_LIMIT");
            run.setError("Spent in the last 7 days US$" + spent.setScale(2, java.math.RoundingMode.HALF_UP)
                + " + estimated US$" + estimate.setScale(2, java.math.RoundingMode.HALF_UP) + " for " + stage
                + " exceeds the weekly limit US$" + limit + "; approve with approve-cost");
            log.warn("KB run {} blocked by the weekly cost limit at {} ({} + {} > {})", runId, stage, spent, estimate,
                limit);
            return true;
        });
    }

    // Stores the canonical JSONL of the stage's PENDING requests (one per
    // model) and, unless dry, executes them in that model's mode.
    private void submit(UUID runId, String stage, int attempt, boolean dry) {
        var executionMode = settings.effective().executionMode();
        // Ids only; the params (raw text for DIGEST) are streamed to a temp
        // file a page at a time, so a large stage never sits in the heap.
        Map<String, List<String>> byModel = inTx(() -> {
            Map<String, List<String>> m = new LinkedHashMap<>();
            for (Object[] r : requests.pendingIdsAndModels(runId, stage)) {
                m.computeIfAbsent((String) r[1], k -> new ArrayList<>()).add((String) r[0]);
            }
            return m;
        });
        int n = 0;
        var syncJobs = new ArrayList<UUID>();
        for (var e : byModel.entrySet()) {
            n++;
            var model = e.getKey();
            var mode = router.modeFor(model, executionMode);
            var ids = e.getValue();
            var base = "kb/runs/" + runId + "/" + stage.toLowerCase(Locale.ROOT)
                + (attempt > 1 ? "-" + attempt : "") + (byModel.size() > 1 ? "-" + n : "");
            if (!dry && mode.equals("BATCH")) {
                // At most KB_BATCH_MAX_REQUESTS per batch file: a bigger stage is
                // several jobs (parts), all queued now; each creation goes through
                // the quota gate (DO allows few creations per hour) and the ones
                // refused wait QUEUED for the poller.
                var parts = KbBatchSubmitter.split(ids, settings.batchMaxRequests());
                int part = 0;
                for (var chunk : parts) {
                    part++;
                    var key = base + (parts.size() > 1 ? "-p" + part : "") + ".jsonl";
                    storeJsonl(key, chunk);
                    // The row first (own transaction, unique per stage/attempt/model/part), then DO.
                    var queued = submitter.queue(runId, stage, attempt, model, part, chunk, key);
                    if (queued != null) submitter.submitQueued(queued.getId());
                }
                continue;
            }
            var key = base + ".jsonl";
            storeJsonl(key, ids);
            var job = inTx(() -> jobs.save(new KbBatchJob(runId, stage, attempt, model, mode, ids.size(), key)));
            if (dry) continue;
            inTxVoid(() -> jobs.findById(job.getId()).orElseThrow().submitted(null, null, now()));
            for (int i = 0; i < ids.size(); i += PAGE) {
                var page = ids.subList(i, Math.min(ids.size(), i + PAGE));
                inTxVoid(() -> requests.markSubmitted(job.getId(), page));
            }
            syncJobs.add(job.getId());
        }
        // Every model's sync job of the stage runs at once (one shared pool).
        if (!syncJobs.isEmpty()) runSyncJobs(syncJobs);
    }

    // Writes the canonical JSONL of these requests (in id order) through a
    // temp file, reading JSONL_PAGE requests per transaction.
    private void storeJsonl(String key, List<String> ids) {
        java.nio.file.Path tmp = null;
        try {
            tmp = java.nio.file.Files.createTempFile("kb-run-", ".jsonl");
            try (var out = new java.io.BufferedWriter(new java.io.OutputStreamWriter(
                    java.nio.file.Files.newOutputStream(tmp), StandardCharsets.UTF_8))) {
                for (int i = 0; i < ids.size(); i += JSONL_PAGE) {
                    var page = ids.subList(i, Math.min(ids.size(), i + JSONL_PAGE));
                    var text = inTx(() -> {
                        Map<String, KbRunRequest> byId = new java.util.HashMap<>();
                        requests.findAllById(page).forEach(r -> byId.put(r.getCustomId(), r));
                        var sb = new StringBuilder();
                        for (var id : page) {
                            var r = byId.get(id);
                            if (r == null) continue;
                            var line = json.createObjectNode();
                            line.put("custom_id", id);
                            line.set("params", r.getParams());
                            sb.append(line).append('\n');
                        }
                        return sb.toString();
                    });
                    out.write(text);
                }
            }
            storage.putFile(key, "application/x-ndjson", tmp);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        } finally {
            if (tmp != null) {
                try {
                    java.nio.file.Files.deleteIfExists(tmp);
                } catch (java.io.IOException ignored) {
                    // best effort
                }
            }
        }
    }

    // SYNC: executes the jobs' requests that have no answer yet, all in one
    // pool of KB_SYNC_CONCURRENCY in-flight requests; each answer is recorded
    // as it arrives (restart-safe). Answers for a run that was cancelled
    // meanwhile are recorded in usage (they were paid for) but not applied.
    // Returns true when the pool paused on DO's daily token quota: the
    // unanswered requests stay SUBMITTED without answer (the state a restart
    // resumes from; never counted as failed), their jobs stay open, and the
    // runs go WAITING with the reason until pausedUntil.
    private boolean runSyncJobs(List<UUID> jobIds) {
        Map<UUID, KbBatchJob> byId = new LinkedHashMap<>();
        Map<String, UUID> jobOf = new java.util.concurrent.ConcurrentHashMap<>();
        var todo = new ArrayList<String>();   // ids only; params are paged in as workers free up
        Map<UUID, Integer> pendingCount = new java.util.HashMap<>();
        inTxVoid(() -> {
            for (var id : jobIds) {
                byId.put(id, jobs.findById(id).orElseThrow());
                var ids = requests.unansweredIdsOfJob(id);
                ids.forEach(c -> jobOf.put(c, id));
                todo.addAll(ids);
                pendingCount.put(id, ids.size());
            }
        });
        Map<UUID, OutFile> outputs = new java.util.concurrent.ConcurrentHashMap<>();
        try {
            var runIds = byId.values().stream().map(KbBatchJob::getRunId).distinct().toList();
            // At most ~2x the concurrency of requests (with their params) in memory.
            var lines = KbPagedLines.of(todo, Math.max(10, sync.concurrency() * 2), tx, requests);
            boolean paused = sync.run(lines, (SyncLlmExecutor.Outcome outcome) -> {
                var result = outcome.result();
                var job = byId.get(jobOf.get(result.customId()));
                recordLock.lock();
                try {
                    inTxVoid(() -> record(job.getRunId(), job.getId(), "SYNC", result, outcome));
                    // The audit copy is streamed to a temp file, not kept in memory.
                    outputs.computeIfAbsent(job.getId(), k -> OutFile.open()).write(outputLine(result));
                } finally {
                    recordLock.unlock();
                }
            }, cancelCheck(runIds));
            var pausedRuns = new java.util.HashSet<UUID>();
            for (var job : byId.values()) {
                var out = outputs.get(job.getId());
                boolean unanswered = paused && inTx(() -> requests.countUnansweredOfJob(job.getId()) > 0);
                String outKey = null;
                if (out != null && out.count > 0) {
                    out.close();
                    outKey = job.getPayloadKey().replace(".jsonl", "-out"
                        + (unanswered ? "-partial-" + now().toEpochSecond()
                            : pendingCount.get(job.getId()) < job.getRequestCount() ? "-resumed" : "") + ".jsonl");
                    putAuditFile(outKey, out.path);
                }
                if (unanswered) {
                    pausedRuns.add(job.getRunId());
                    continue;
                }
                var key = outKey;
                inTxVoid(() -> {
                    var j = jobs.findById(job.getId()).orElseThrow();
                    if (j.getStatus().equals("SUBMITTED")) j.finish("COMPLETED", key, now(), null);
                });
                log.info("KB run {} {} sync job done ({} requests, {})", job.getRunId(), job.getStage(),
                    pendingCount.get(job.getId()), job.getModel());
            }
            for (var runId : runIds) {
                if (!pausedRuns.contains(runId)) inTxVoid(() -> runs.setStatusIf(runId, "RUNNING", MOVING));
            }
            for (var runId : pausedRuns) pauseForQuota(runId);
            return !pausedRuns.isEmpty();
        } finally {
            outputs.values().forEach(OutFile::discard);
        }
    }

    // Output lines of a sync job, appended to a temp file (callers hold recordLock).
    private static final class OutFile {
        final java.nio.file.Path path;
        final java.io.BufferedWriter writer;
        long count;

        private OutFile(java.nio.file.Path path, java.io.BufferedWriter writer) {
            this.path = path;
            this.writer = writer;
        }

        static OutFile open() {
            try {
                var p = java.nio.file.Files.createTempFile("kb-sync-out-", ".jsonl");
                return new OutFile(p, java.nio.file.Files.newBufferedWriter(p, StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }

        void write(ObjectNode line) {
            try {
                writer.write(line.toString());
                writer.write('\n');
                count++;
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }

        void close() {
            try {
                writer.close();
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }

        void discard() {
            try {
                writer.close();
            } catch (java.io.IOException ignored) {
                // closing a discarded file
            }
            try {
                java.nio.file.Files.deleteIfExists(path);
            } catch (java.io.IOException ignored) {
                // best effort
            }
        }
    }

    // Daily token quota spent: no reply until pausedUntil (every 30 min the
    // snapshot is re-checked, with a real request when it is stale).
    private void pauseForQuota(UUID runId) {
        var until = now().plus(DoQuotaTracker.DAILY_RETRY);
        quotaPausedUntil.put(runId, until);
        var at = until.atZoneSameInstant(org.ceitba.api.config.ClockConfig.ZONE)
            .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"));
        var reason = QUOTA_PAUSE + at;
        inTxVoid(() -> {
            runs.setStatusIf(runId, "WAITING", MOVING);
            runs.findById(runId).filter(KbRun::isActive).ifPresent(r -> r.setError(reason));
        });
        log.warn("KB run {} paused: {}", runId, reason);
    }

    // True while the run's quota pause has not elapsed; once it has, the
    // pause and its reason are cleared and the run goes on.
    private boolean quotaPaused(UUID runId) {
        var until = quotaPausedUntil.get(runId);
        if (until == null) return false;
        if (now().isBefore(until)) return true;
        quotaPausedUntil.remove(runId, until);
        inTxVoid(() -> runs.findById(runId).filter(r -> r.getError() != null && r.getError().startsWith(QUOTA_PAUSE_PREFIX))
            .ifPresent(r -> r.setError(null)));
        return false;
    }

    // Runs whose quota pause is over (the batch poller kicks them).
    public List<UUID> quotaResumeDue() {
        var now = now();
        return quotaPausedUntil.entrySet().stream().filter(e -> !now.isBefore(e.getValue())).map(Map.Entry::getKey).toList();
    }

    // Whether every run of a sync pool was cancelled, read from the DB at most
    // every few seconds and shared by all workers (one transaction per check,
    // not one per request).
    private java.util.function.BooleanSupplier cancelCheck(List<UUID> runIds) {
        var stopped = new java.util.concurrent.atomic.AtomicBoolean(false);
        var checkedAt = new java.util.concurrent.atomic.AtomicLong(System.nanoTime() - CANCEL_CHECK.toNanos());
        return () -> {
            long last = checkedAt.get();
            long t = System.nanoTime();
            if (!stopped.get() && t - last >= CANCEL_CHECK.toNanos() && checkedAt.compareAndSet(last, t)) {
                stopped.set(runIds.stream()
                    .noneMatch(id -> inTx(() -> runs.findById(id).map(KbRun::isActive).orElse(false))));
            }
            return stopped.get();
        };
    }

    private ObjectNode outputLine(LlmOutputParser.LlmResult r) {
        var o = json.createObjectNode();
        o.put("custom_id", r.customId());
        o.put("ok", r.ok());
        o.put("path", r.path());
        if (r.toolInput() != null) o.set("result", r.toolInput());
        else if (r.text() != null) o.put("text", r.text());
        if (r.error() != null) o.put("error", r.error());
        var u = o.putObject("usage");
        u.put("input_tokens", r.tokensIn());
        u.put("cached_input_tokens", r.cachedTokens());
        u.put("output_tokens", r.tokensOut());
        return o;
    }

    // BATCH: a finished batch, recorded, then its audit copy stored (best
    // effort: a storage hiccup must not lose results that were paid for).
    // The output and error files go to temp files and are read line by line:
    // results are recorded RECORD_PAGE at a time, each page in its own
    // transaction (idempotent: an answered request is skipped on a retry).
    static final int RECORD_PAGE = 100;

    private void collectBatch(UUID jobId, LlmBatchClient.BatchInfo info) {
        var job = inTx(() -> jobs.findById(jobId).orElseThrow());
        var files = batch.collectToFiles(job.getDoBatchId(), info.status().equals("completed"));
        try {
            var key = files.output() == null ? null : job.getPayloadKey().replace(".jsonl", "-out.jsonl");
            var status = switch (info.status()) {
                case "completed" -> "COMPLETED";
                case "cancelled" -> "CANCELLED";
                default -> "FAILED";
            };
            var error = status.equals("COMPLETED") ? null : batchError(info);
            // A batch refused as a whole (e.g. DO's JSONL model validation) is not
            // resubmitted: the same file would fail the same way.
            boolean permanent = status.equals("FAILED") && info.errorMessage() != null
                && DoBatchErrors.classifyFailure(info.errorMessage()) != DoBatchErrors.Kind.RATE_LIMITED
                && !hasResults(files);
            recordResults(job, files.errors());
            recordResults(job, files.output());   // the output wins over the error file
            inTxVoid(() -> {
                var run = runs.lockById(job.getRunId()).orElseThrow();   // first: same lock order as cancel
                if (error != null) {
                    forPages(requests.unansweredIdsOfJob(jobId), rows -> rows.forEach(r -> {
                        if (permanent) r.failed(error);
                        else r.setError(error);
                    }));
                }
                jobs.findById(jobId).orElseThrow().finish(status, key, now(), error);
                if (run.isActive()) {
                    run.setStatus("RUNNING");
                    if (permanent) run.setError(error + " (" + job.getStage() + ", " + job.getModel() + ")");
                }
            });
            if (key != null) putAuditFile(key, files.output());
            if (files.errors() != null) putAuditFile(job.getPayloadKey().replace(".jsonl", "-err.jsonl"), files.errors());
            log.info("KB run {} {} batch {} {}{}", job.getRunId(), job.getStage(), info.id(), info.status(),
                error == null ? "" : ": " + error);
        } finally {
            files.delete();
        }
    }

    private boolean hasResults(BatchLlmExecutor.CollectedFiles files) {
        var any = new boolean[1];
        for (var f : new java.nio.file.Path[] {files.errors(), files.output()}) {
            if (f != null && !any[0]) LlmOutputParser.parse(f, json, r -> any[0] = true);
        }
        return any[0];
    }

    private void recordResults(KbBatchJob job, java.nio.file.Path file) {
        if (file == null) return;
        var page = new ArrayList<LlmOutputParser.LlmResult>(RECORD_PAGE);
        LlmOutputParser.parse(file, json, r -> {
            page.add(r);
            if (page.size() >= RECORD_PAGE) recordPage(job, page);
        });
        recordPage(job, page);
    }

    private void recordPage(KbBatchJob job, List<LlmOutputParser.LlmResult> page) {
        if (page.isEmpty()) return;
        var results = List.copyOf(page);
        page.clear();
        inTxVoid(() -> {
            runs.lockById(job.getRunId()).orElseThrow();   // first: same lock order as cancel
            for (var res : results) record(job.getRunId(), job.getId(), "BATCH", res, null);
        });
    }

    // Stores a file as an audit copy with the reasoning_content of reasoning
    // models removed, streamed line by line (never raises: results are already recorded).
    private void putAuditFile(String key, java.nio.file.Path file) {
        java.nio.file.Path clean = null;
        try {
            clean = java.nio.file.Files.createTempFile("kb-audit-", ".jsonl");
            try (var in = java.nio.file.Files.newBufferedReader(file, StandardCharsets.UTF_8);
                 var out = java.nio.file.Files.newBufferedWriter(clean, StandardCharsets.UTF_8)) {
                String line;
                while ((line = in.readLine()) != null) {
                    if (line.isBlank()) continue;
                    if (line.contains("reasoning_content")) {
                        try {
                            var node = json.readTree(line);
                            stripReasoning(node);
                            line = node.toString();
                        } catch (Exception e) {
                            // keep the line as it came
                        }
                    }
                    out.write(line);
                    out.write('\n');
                }
            }
            storage.putFile(key, "application/x-ndjson", clean);
        } catch (java.io.IOException | RuntimeException e) {
            log.warn("KB: storing the audit copy {} failed (results are recorded): {}", key, e.getMessage());
        } finally {
            if (clean != null) {
                try {
                    java.nio.file.Files.deleteIfExists(clean);
                } catch (java.io.IOException ignored) {
                    // best effort
                }
            }
        }
    }

    // DO's error_message of a batch that did not complete (else its status).
    static String batchError(LlmBatchClient.BatchInfo info) {
        if (info.errorMessage() != null && !info.errorMessage().isBlank()) {
            return "DigitalOcean batch " + info.status() + ": " + info.errorMessage();
        }
        return "DigitalOcean batch " + info.status();
    }

    // Keeps DO's status and request_counts of a polled batch (progress).
    private void observe(UUID jobId, LlmBatchClient.BatchInfo info) {
        com.fasterxml.jackson.databind.JsonNode counts = null;
        try {
            if (info.raw() != null) counts = json.readTree(info.raw()).path("request_counts");
        } catch (Exception ignored) {
            // no counts
        }
        var c = counts;
        inTxVoid(() -> jobs.findById(jobId).ifPresent(j -> j.observed(info.status(), c, now())));
    }

    static boolean emptyOrTruncated(String error) {
        return error != null && (error.startsWith("EMPTY_TOOL") || error.startsWith("TRUNCATED"));
    }

    private static void stripReasoning(JsonNode node) {
        if (node instanceof ObjectNode o) {
            o.remove("reasoning_content");
            o.elements().forEachRemaining(KbRunEngine::stripReasoning);
        } else if (node != null && node.isArray()) {
            node.elements().forEachRemaining(KbRunEngine::stripReasoning);
        }
    }

    // One answer: request row, usage (frozen cost), job/run/subject totals.
    // outcome: the sync attempts (one usage row each, with latency and
    // reasoning tokens); null for batch (one row, the job's attempt number).
    private void record(UUID runId, UUID jobId, String mode, LlmOutputParser.LlmResult res,
                        SyncLlmExecutor.Outcome outcome) {
        // The run row first (locked): the same order as cancel, so they never deadlock.
        var run = runs.lockById(runId).orElseThrow();
        var r = requests.findById(res.customId()).orElse(null);
        if (r == null || r.getStatus().equals("DONE")) return;
        if (r.getBatchJobId() != null && !r.getBatchJobId().equals(jobId)) return;   // an older job's late answer
        r.answered(now(), outcome == null ? null : outcome.latencyMs());
        var handler = handler(run);
        if (res.ok()) {
            var path = emptyOrTruncated(r.getError()) && res.path() != null && !res.path().endsWith("+retry")
                ? res.path() + "+retry" : res.path();
            r.done(res.toolInput() != null ? res.toolInput() : TextNode.valueOf(res.text()), res.tokensIn(),
                res.tokensOut(), res.cachedTokens(), path);
        } else {
            r.setError(res.error());
        }
        boolean paid = res.tokensIn() > 0 || res.tokensOut() > 0
            || (outcome != null && outcome.attempts().stream().anyMatch(a -> a.tokensIn() > 0 || a.tokensOut() > 0));
        if (!paid) return;
        var stage = handler.usageStage(r.getStage());
        var cost = BigDecimal.ZERO;
        UUID usageRun = run.isEval() ? null : runId;
        UUID usageEval = run.isEval() ? runId : null;
        if (outcome != null && !outcome.attempts().isEmpty()) {
            int n = 0;
            for (var a : outcome.attempts()) {
                n++;
                cost = cost.add(usage.record(usageRun, usageEval, r.getCustomId(), r.getModel(), mode, stage,
                    r.getSubjectId(), a.tokensIn(), a.cachedTokens(), a.tokensOut(), n, a.latencyMs(),
                    a.reasoningTokens()));
            }
        } else {
            int attempt = jobs.findById(jobId).map(KbBatchJob::getAttempt).orElse(1);
            cost = usage.record(usageRun, usageEval, r.getCustomId(), r.getModel(), mode, stage, r.getSubjectId(),
                res.tokensIn(), res.cachedTokens(), res.tokensOut(), attempt, null, null);
        }
        var total = cost;
        jobs.findById(jobId).ifPresent(j -> j.addUsage(res.tokensIn(), res.tokensOut(), res.cachedTokens(), total));
        run.addTokens(res.tokensIn(), res.tokensOut());
        run.addCached(res.cachedTokens());
        run.addCost(total);
        if (router.simulated()) run.setSimulated(true);
        runSubjects.findById(new KbRunSubjectId(runId, r.getSubjectId()))
            .ifPresent(s -> s.addUsage(res.tokensIn(), res.tokensOut(), res.cachedTokens(), total));
    }

    // ==== helpers for handlers ==================================================

    public KbRunRequest request(KbRun run, String subjectId, String stage, String target, int chunk, String model,
                                JsonNode params, Seq seq) {
        var customId = run.getId().toString().substring(0, 8) + "-" + stage.charAt(0) + "-"
            + String.format("%06d", seq.next());
        var itemKey = run.getId() + ":" + stage + ":" + subjectId + ":" + target + ":" + chunk;
        return new KbRunRequest(customId, run.getId(), stage, subjectId, itemKey, target, chunk, model, params,
            KbPayloads.estimateTokens(params));
    }

    private KbRunHandler handler(KbRun run) {
        return handlers.stream().filter(h -> h.handles(run)).findFirst()
            .orElseThrow(() -> new IllegalStateException("No handler for run " + run.getId()));
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    public <T> T inTx(Supplier<T> work) {
        return tx.execute(status -> work.get());
    }

    public void inTxVoid(Runnable work) {
        tx.executeWithoutResult(status -> work.run());
    }
}
