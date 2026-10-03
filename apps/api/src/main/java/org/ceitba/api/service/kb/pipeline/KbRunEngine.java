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
    static final List<String> LLM_STAGES = List.of("DIGEST", "PLAN", "WRITE", "RETRY");
    static final int MAX_STEPS = 200;

    private final KbRunRepository runs;
    private final KbBatchJobRepository jobs;
    private final KbRunRequestRepository requests;
    private final KbRunSubjectRepository runSubjects;
    private final List<KbRunHandler> handlers;
    private final KbLlmRouter router;
    private final BatchLlmExecutor batch;
    private final SyncLlmExecutor sync;
    private final KbUsageRecorder usage;
    private final KbSettingsService settings;
    private final KbCostService costs;
    private final ObjectStorage storage;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;
    private final AtomicBoolean advancing = new AtomicBoolean(false);
    private final AtomicBoolean again = new AtomicBoolean(false);
    private final Object recordLock = new Object();

    public KbRunEngine(KbRunRepository runs, KbBatchJobRepository jobs, KbRunRequestRepository requests,
                       KbRunSubjectRepository runSubjects, @Lazy List<KbRunHandler> handlers, KbLlmRouter router,
                       BatchLlmExecutor batch, SyncLlmExecutor sync, KbUsageRecorder usage,
                       KbSettingsService settings, KbCostService costs, ObjectStorage storage,
                       TransactionTemplate tx, ObjectMapper json, Clock clock) {
        this.runs = runs;
        this.jobs = jobs;
        this.requests = requests;
        this.runSubjects = runSubjects;
        this.handlers = handlers;
        this.router = router;
        this.batch = batch;
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

    // Advances every active run as far as it can go now. A call made while
    // another is advancing returns at once and makes that one loop again (so
    // a run triggered meanwhile is not left for the next poll).
    public void advanceActive() {
        again.set(true);
        while (again.get() && advancing.compareAndSet(false, true)) {
            try {
                again.set(false);
                var active = inTx(() -> runs.findByStatusIn(ACTIVE).stream().map(KbRun::getId).toList());
                for (var id : active) {
                    for (int i = 0; i < MAX_STEPS && step(id); i++) {
                        // keep going
                    }
                }
            } finally {
                advancing.set(false);
            }
        }
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
            var rows = requests.findByRunIdAndStage(runId, stageBefore);
            long done = rows.stream().filter(x -> x.getStatus().equals("DONE")).count();
            long failed = rows.stream().filter(x -> x.getStatus().equals("FAILED")).count();
            log.info("KB {} {}: {} -> {} ({}; {} requests: {} done, {} failed)", r.isEval() ? "eval" : "run", runId,
                stageBefore, r.getStage(), r.getStatus(), rows.size(), done, failed);
        });
    }

    private boolean stepOnce(UUID runId) {
        var run = inTx(() -> runs.findById(runId).orElse(null));
        if (run == null || !run.isActive() || run.getStatus().equals("BLOCKED_BY_COST_LIMIT")) return false;
        var handler = handler(run);
        try {
            if (run.getStage().equals("DETECT")) {
                inTxVoid(() -> handler.detect(runs.findById(runId).orElseThrow()));
                return true;
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
            inTxVoid(() -> runs.findById(runId).ifPresent(r -> {
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
        return inTx(() -> {
            var r = runs.findById(runId).orElseThrow();
            for (var j : jobs.findByRunIdOrderByCreatedAtAsc(runId)) {
                if (j.getStatus().equals("SUBMITTED")) j.setStatus("CANCELLED");
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
            var r = runs.findById(runId).orElseThrow(() -> new ResourceNotFoundException("KbRun", runId.toString()));
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
                    var r = runs.findById(runId).orElseThrow();
                    return handler.build(r, stage, new Seq((int) requests.countByRunId(runId)));
                });
                if (built == 0) {
                    inTxVoid(() -> handler.after(runs.findById(runId).orElseThrow(), stage));
                    return true;
                }
            }
            if (!dry && handler.costLimited() && blockedByCost(runId, stage)) return false;
            submit(runId, stage, 1, dry);
            return true;
        }
        var open = stageJobs.stream().filter(j -> j.getStatus().equals("SUBMITTED")).toList();
        if (!open.isEmpty()) {
            boolean allDone = true;
            // Sync jobs (one per model) resume together, sharing the concurrency.
            var openSync = open.stream().filter(j -> j.getMode().equals("SYNC")).map(KbBatchJob::getId).toList();
            if (!openSync.isEmpty()) runSyncJobs(openSync);
            for (var job : open) {
                if (job.getMode().equals("SYNC")) continue;
                var info = batch.poll(job.getDoBatchId());
                observe(job.getId(), info);
                if (info.finished()) collectBatch(job.getId(), info);
                else allDone = false;
            }
            if (!allDone) {
                inTxVoid(() -> runs.findById(runId).ifPresent(r -> r.setStatus("WAITING")));
                return false;
            }
            return true;
        }
        if (dry) {
            inTxVoid(() -> handler.after(runs.findById(runId).orElseThrow(), stage));
            return true;
        }
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
            return ids;
        });
        if (!leftover.isEmpty() && maxAttempt < 2) {
            inTxVoid(() -> requests.findAllById(leftover).forEach(r -> {
                if (emptyOrTruncated(r.getError())) r.doubleMaxTokens(SyncLlmExecutor.MAX_TOKENS_CAP);
                r.setStatus("PENDING");
            }));
            submit(runId, stage, maxAttempt + 1, false);
            return true;
        }
        inTxVoid(() -> {
            requests.findAllById(leftover).forEach(r -> r.failed(r.getError() == null
                ? "no answer after resubmission" : r.getError()));
            handler.after(runs.findById(runId).orElseThrow(), stage);
        });
        return true;
    }

    // Weekly cost limit: the run's recorded cost plus this stage's estimate.
    private boolean blockedByCost(UUID runId, String stage) {
        var limit = settings.effective().weeklyCostLimitUsd();
        if (limit == null) return false;
        return inTx(() -> {
            var run = runs.findById(runId).orElseThrow();
            if (run.isCostApproved()) return false;
            var mode = settings.effective().executionMode();
            var estimate = run.getCostEstimate() == null ? BigDecimal.ZERO : run.getCostEstimate();
            for (var r : requests.findByRunIdAndStageAndStatusIn(runId, stage, List.of("PENDING"))) {
                estimate = estimate.add(costs.estimate(r.getModel(), router.modeFor(r.getModel(), mode),
                    r.getEstTokens(), r.getParams().path("max_tokens").asLong(4096)));
            }
            if (estimate.compareTo(limit) <= 0) return false;
            run.setStatus("BLOCKED_BY_COST_LIMIT");
            run.setError("Estimated cost US$" + estimate.setScale(2, java.math.RoundingMode.HALF_UP)
                + " exceeds the weekly limit US$" + limit + " at " + stage + "; approve with approve-cost");
            log.warn("KB run {} blocked by the cost limit at {} ({} > {})", runId, stage, estimate, limit);
            return true;
        });
    }

    // Stores the canonical JSONL of the stage's PENDING requests (one per
    // model) and, unless dry, executes them in that model's mode.
    private void submit(UUID runId, String stage, int attempt, boolean dry) {
        var executionMode = settings.effective().executionMode();
        Map<String, List<KbRunRequest>> byModel = inTx(() -> {
            Map<String, List<KbRunRequest>> m = new LinkedHashMap<>();
            for (var r : requests.findByRunIdAndStageAndStatusIn(runId, stage, List.of("PENDING"))) {
                m.computeIfAbsent(r.getModel(), k -> new ArrayList<>()).add(r);
            }
            return m;
        });
        int n = 0;
        var syncJobs = new ArrayList<UUID>();
        for (var e : byModel.entrySet()) {
            n++;
            var model = e.getKey();
            var mode = router.modeFor(model, executionMode);
            var lines = e.getValue().stream().map(r -> new LlmLine(r.getCustomId(), r.getParams())).toList();
            var sb = new StringBuilder();
            for (var l : lines) {
                var line = json.createObjectNode();
                line.put("custom_id", l.customId());
                line.set("params", l.params());
                sb.append(line).append('\n');
            }
            var bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
            var key = "kb/runs/" + runId + "/" + stage.toLowerCase(Locale.ROOT)
                + (attempt > 1 ? "-" + attempt : "") + (byModel.size() > 1 ? "-" + n : "") + ".jsonl";
            storage.put(key, "application/x-ndjson", new ByteArrayInputStream(bytes), bytes.length);
            var job = inTx(() -> jobs.save(new KbBatchJob(runId, stage, attempt, model, mode, lines.size(), key)));
            if (dry) continue;
            var ids = lines.stream().map(LlmLine::customId).toList();
            if (mode.equals("BATCH")) {
                var submitted = batch.submit(key.replace('/', '_'), model, lines, job.getId().toString());
                inTxVoid(() -> {
                    jobs.findById(job.getId()).orElseThrow().submitted(submitted.fileId(), submitted.batchId(), now());
                    requests.findAllById(ids).forEach(r -> r.submitted(job.getId()));
                    runs.findById(runId).ifPresent(r -> r.setStatus("RUNNING"));
                });
                log.info("KB run {} {} batch {} submitted ({} requests, {})", runId, stage, submitted.batchId(),
                    lines.size(), model);
            } else {
                inTxVoid(() -> {
                    jobs.findById(job.getId()).orElseThrow().submitted(null, null, now());
                    requests.findAllById(ids).forEach(r -> r.submitted(job.getId()));
                });
                syncJobs.add(job.getId());
            }
        }
        // Every model's sync job of the stage runs at once (one shared pool).
        if (!syncJobs.isEmpty()) runSyncJobs(syncJobs);
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
                var bytes = out.toString().getBytes(StandardCharsets.UTF_8);
                storage.put(outKey, "application/x-ndjson", new ByteArrayInputStream(bytes), bytes.length);
            }
            var key = outKey;
            inTxVoid(() -> {
                var j = jobs.findById(job.getId()).orElseThrow();
                if (j.getStatus().equals("SUBMITTED")) j.finish("COMPLETED", key, now(), null);
                runs.findById(job.getRunId()).filter(KbRun::isActive).ifPresent(r -> r.setStatus("RUNNING"));
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

    // BATCH: a finished batch, stored and recorded.
    private void collectBatch(UUID jobId, LlmBatchClient.BatchInfo info) {
        var job = inTx(() -> jobs.findById(jobId).orElseThrow());
        var collected = batch.collect(job.getDoBatchId(), info.status().equals("completed"));
        String outKey = null;
        var output = withoutReasoning(collected.output());
        var errors = withoutReasoning(collected.errors());
        if (output != null) {
            outKey = job.getPayloadKey().replace(".jsonl", "-out.jsonl");
            storage.put(outKey, "application/x-ndjson", new ByteArrayInputStream(output), output.length);
        }
        if (errors != null) {
            storage.put(job.getPayloadKey().replace(".jsonl", "-err.jsonl"), "application/x-ndjson",
                new ByteArrayInputStream(errors), errors.length);
        }
        var key = outKey;
        inTxVoid(() -> {
            for (var r : requests.findByBatchJobId(jobId)) {
                var res = collected.results().get(r.getCustomId());
                if (res != null) record(job.getRunId(), jobId, "BATCH", res, null);
            }
            var status = switch (info.status()) {
                case "completed" -> "COMPLETED";
                case "cancelled" -> "CANCELLED";
                default -> "FAILED";
            };
            jobs.findById(jobId).orElseThrow().finish(status, key, now(), status.equals("COMPLETED") ? null : info.status());
            runs.findById(job.getRunId()).ifPresent(r -> r.setStatus("RUNNING"));
        });
        log.info("KB run {} {} batch {} {}", job.getRunId(), job.getStage(), info.id(), info.status());
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
        var r = requests.findById(res.customId()).orElse(null);
        if (r == null || r.getStatus().equals("DONE")) return;
        r.answered(now(), outcome == null ? null : outcome.latencyMs());
        var run = runs.findById(runId).orElseThrow();
        var handler = handler(run);
        if (res.ok()) {
            var path = emptyOrTruncated(r.getError()) && res.path() != null && !res.path().endsWith("+retry")
                ? res.path() + "+retry" : res.path();
            r.done(res.toolInput() != null ? res.toolInput() : TextNode.valueOf(res.text()), res.tokensIn(),
                res.tokensOut(), res.cachedTokens(), path);
        } else {
            r.setError(res.error());
        }
        if (res.tokensIn() == 0 && res.tokensOut() == 0) return;
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
