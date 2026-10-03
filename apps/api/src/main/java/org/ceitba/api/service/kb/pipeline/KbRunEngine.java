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
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
import org.ceitba.api.service.media.ObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
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
    public static final java.time.Duration LEASE = java.time.Duration.ofMinutes(3);
    static final java.time.Duration LEASE_RENEW = java.time.Duration.ofSeconds(60);
    private final Object recordLock = new Object();

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
            int pending = inTx(() -> requests.findByRunIdAndStageAndStatusIn(runId, stage, List.of("PENDING")).size());
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
            if (!openSync.isEmpty()) runSyncJobs(openSync);
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
            for (var r : requests.findByRunIdAndStageAndStatusIn(runId, stage, List.of("SUBMITTED", "PENDING"))) {
                // Sync already retried empty/truncated answers with double max_tokens.
                if (syncJobs.contains(r.getBatchJobId()) && emptyOrTruncated(r.getError())) {
                    r.failed(r.getError());
                    continue;
                }
                ids.add(r.getCustomId());
            }
            // Answered but unusable (e.g. a PLAN whose operations were all
            // dropped): sent once more with the second attempt.
            if (maxAttempt < 2) {
                runs.findById(runId).filter(KbRun::isActive).ifPresent(r -> ids.addAll(handler.redo(r, stage)));
            }
            return ids;
        });
        if (!leftover.isEmpty() && maxAttempt < 2) {
            if (handler.costLimited() && blockedByCost(runId, stage, leftover)) return false;
            inTxVoid(() -> requests.findAllById(leftover).forEach(r -> {
                if (emptyOrTruncated(r.getError())) r.doubleMaxTokens(SyncLlmExecutor.MAX_TOKENS_CAP);
                r.setStatus("PENDING");
            }));
            submit(runId, stage, maxAttempt + 1, false);
            return true;
        }
        return whileActive(runId, r -> {
            requests.findAllById(leftover).forEach(q -> q.failed(q.getError() == null
                ? "no answer after resubmission" : q.getError()));
            handler.after(r, stage);
        });
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
            var pending = only == null ? requests.findByRunIdAndStageAndStatusIn(runId, stage, List.of("PENDING"))
                : requests.findAllById(only);
            for (var r : pending) {
                estimate = estimate.add(costs.estimate(r.getModel(), router.modeFor(r.getModel(), mode),
                    r.getEstTokens(), r.getParams().path("max_tokens").asLong(4096)));
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
            var key = "kb/runs/" + runId + "/" + stage.toLowerCase(Locale.ROOT)
                + (attempt > 1 ? "-" + attempt : "") + (byModel.size() > 1 ? "-" + n : "") + ".jsonl";
            storeJsonl(key, ids);
            if (!dry && mode.equals("BATCH")) {
                // The row first (own transaction, unique per stage/attempt/model), then DO.
                var queued = submitter.queue(runId, stage, attempt, model, ids, key);
                if (queued != null) submitter.submitQueued(queued.getId());
                continue;
            }
            var job = inTx(() -> jobs.save(new KbBatchJob(runId, stage, attempt, model, mode, ids.size(), key)));
            if (dry) continue;
            inTxVoid(() -> {
                jobs.findById(job.getId()).orElseThrow().submitted(null, null, now());
                requests.findAllById(ids).forEach(r -> r.submitted(job.getId()));
            });
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
    private void runSyncJobs(List<UUID> jobIds) {
        Map<UUID, KbBatchJob> byId = new LinkedHashMap<>();
        Map<String, UUID> jobOf = new java.util.HashMap<>();
        var lines = new ArrayList<LlmLine>();
        Map<UUID, Integer> pendingCount = new java.util.HashMap<>();
        inTxVoid(() -> {
            for (var id : jobIds) {
                var job = jobs.findById(id).orElseThrow();
                byId.put(id, job);
                int c = 0;
                for (var r : requests.findByBatchJobId(id)) {
                    if (!r.getStatus().equals("SUBMITTED") || r.getCompletedAt() != null) continue;
                    lines.add(new LlmLine(r.getCustomId(), r.getParams()));
                    jobOf.put(r.getCustomId(), id);
                    c++;
                }
                pendingCount.put(id, c);
            }
        });
        Map<UUID, StringBuffer> outputs = new java.util.concurrent.ConcurrentHashMap<>();
        sync.run(lines, (SyncLlmExecutor.Outcome outcome) -> {
            var result = outcome.result();
            var job = byId.get(jobOf.get(result.customId()));
            synchronized (recordLock) {
                inTxVoid(() -> record(job.getRunId(), job.getId(), "SYNC", result, outcome));
            }
            outputs.computeIfAbsent(job.getId(), k -> new StringBuffer()).append(outputLine(result)).append('\n');
        }, () -> byId.values().stream().map(KbBatchJob::getRunId).distinct()
            .noneMatch(id -> inTx(() -> runs.findById(id).map(KbRun::isActive).orElse(false))));
        for (var job : byId.values()) {
            var out = outputs.get(job.getId());
            String outKey = null;
            if (out != null && out.length() > 0) {
                outKey = job.getPayloadKey().replace(".jsonl", "-out"
                    + (pendingCount.get(job.getId()) < job.getRequestCount() ? "-resumed" : "") + ".jsonl");
                putAudit(outKey, out.toString().getBytes(StandardCharsets.UTF_8));
            }
            var key = outKey;
            inTxVoid(() -> {
                var j = jobs.findById(job.getId()).orElseThrow();
                if (j.getStatus().equals("SUBMITTED")) j.finish("COMPLETED", key, now(), null);
                runs.setStatusIf(job.getRunId(), "RUNNING", MOVING);
            });
            log.info("KB run {} {} sync job done ({} requests, {})", job.getRunId(), job.getStage(),
                pendingCount.get(job.getId()), job.getModel());
        }
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
    private void collectBatch(UUID jobId, LlmBatchClient.BatchInfo info) {
        var job = inTx(() -> jobs.findById(jobId).orElseThrow());
        var collected = batch.collect(job.getDoBatchId(), info.status().equals("completed"));
        var output = withoutReasoning(collected.output());
        var errors = withoutReasoning(collected.errors());
        var key = output == null ? null : job.getPayloadKey().replace(".jsonl", "-out.jsonl");
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
            && collected.results().isEmpty();
        inTxVoid(() -> {
            var run = runs.lockById(job.getRunId()).orElseThrow();   // first: same lock order as cancel
            for (var r : requests.findByBatchJobId(jobId)) {
                var res = collected.results().get(r.getCustomId());
                if (res != null) record(job.getRunId(), jobId, "BATCH", res, null);
                else if (error != null && r.getStatus().equals("SUBMITTED")) {
                    if (permanent) r.failed(error);
                    else r.setError(error);
                }
            }
            jobs.findById(jobId).orElseThrow().finish(status, key, now(), error);
            if (run.isActive()) {
                run.setStatus("RUNNING");
                if (permanent) run.setError(error + " (" + job.getStage() + ", " + job.getModel() + ")");
            }
        });
        if (key != null) putAudit(key, output);
        if (errors != null) putAudit(job.getPayloadKey().replace(".jsonl", "-err.jsonl"), errors);
        log.info("KB run {} {} batch {} {}{}", job.getRunId(), job.getStage(), info.id(), info.status(),
            error == null ? "" : ": " + error);
    }

    private void putAudit(String key, byte[] bytes) {
        try {
            storage.put(key, "application/x-ndjson", new ByteArrayInputStream(bytes), bytes.length);
        } catch (RuntimeException e) {
            log.warn("KB: storing the audit copy {} failed (results are recorded): {}", key, e.getMessage());
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

    // Removes reasoning_content (reasoning models' thoughts) from output
    // lines before they are stored.
    private byte[] withoutReasoning(byte[] jsonl) {
        if (jsonl == null) return null;
        var sb = new StringBuilder();
        for (var line : new String(jsonl, StandardCharsets.UTF_8).split("\n")) {
            if (line.isBlank()) continue;
            if (!line.contains("reasoning_content")) {
                sb.append(line).append('\n');
                continue;
            }
            try {
                var node = json.readTree(line);
                stripReasoning(node);
                sb.append(node).append('\n');
            } catch (Exception e) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
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
