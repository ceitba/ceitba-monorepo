package org.ceitba.api.service.kb.progress;

import com.fasterxml.jackson.databind.JsonNode;
import org.ceitba.api.web.kb.dto.KbProgressResponse;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Predicate;
import java.util.stream.Collectors;

// Pure progress computation (tested on fixtures): request rows (no
// payloads), batch jobs and run state in, KbProgressResponse out.
public final class KbProgressMath {

    public static final List<String> LLM = List.of("DIGEST", "PLAN", "WRITE", "RETRY");
    public static final List<String> STAGES = List.of("DIGEST", "PLAN", "WRITE", "RETRY", "LINK", "VALIDATE", "PUBLISH");
    // Expected input tokens of a request not built yet (overall weighting).
    static final Map<String, Integer> DEFAULT_TOKENS = Map.of("DIGEST", 6000, "PLAN", 6000, "WRITE", 9000, "RETRY", 11000);
    static final int PAGES_PER_PLAN = 4;
    static final double RETRY_SHARE = 0.15;
    static final Duration SYNC_STALL = Duration.ofMinutes(10);
    static final Duration BATCH_STALL = Duration.ofHours(26);
    static final int LATENCY_WINDOW = 10;

    private KbProgressMath() {}

    // failedAnswer: answered with an error, awaiting resubmission (still SUBMITTED):
    // counted as in flight, not failed, since the engine resends it once.
    public record Row(String stage, String status, boolean failedAnswer, int estTokens, String model,
                      OffsetDateTime createdAt, OffsetDateTime completedAt, Integer latencyMs, String target,
                      String subjectId) {

        boolean finished() {
            return status.equals("DONE") || status.equals("FAILED");
        }

        boolean failed() {
            return status.equals("FAILED");
        }

        boolean inFlight() {
            return status.equals("SUBMITTED");
        }
    }

    // status QUEUED: created before DO was called; nextAttemptAt/error when
    // its creation was refused (error RATE_LIMITED: ... for a 429).
    public record Job(String stage, String mode, String status, String doStatus, Integer countTotal,
                      Integer countCompleted, Integer countFailed, OffsetDateTime submittedAt,
                      OffsetDateTime statusChangedAt, OffsetDateTime completedAt, OffsetDateTime nextAttemptAt,
                      String error) {

        public Job(String stage, String mode, String status, String doStatus, Integer countTotal,
                   Integer countCompleted, Integer countFailed, OffsetDateTime submittedAt,
                   OffsetDateTime statusChangedAt, OffsetDateTime completedAt) {
            this(stage, mode, status, doStatus, countTotal, countCompleted, countFailed, submittedAt, statusChangedAt,
                completedAt, null, null);
        }

        boolean open() {
            return mode.equals("BATCH") && (status.equals("SUBMITTED") || status.equals("QUEUED"));
        }

        boolean rateLimited() {
            return status.equals("QUEUED") && nextAttemptAt != null && error != null;
        }
    }

    // stage: the run's stage (DETECT, DIGEST..RETRY, PUBLISH, REPORT, DONE).
    // expectedPlan: PLAN requests known up front (subjects, x configs for
    // evals). publish*: subjects for the PUBLISH stage (pipeline only).
    public record Run(boolean eval, String stage, String status, boolean dryRun, OffsetDateTime startedAt,
                      OffsetDateTime finishedAt, JsonNode stageLog, int expectedPlan, int publishTotal,
                      int publishDone, int publishFailed, String error) {

        boolean active() {
            return List.of("RUNNING", "WAITING", "BLOCKED_BY_COST_LIMIT").contains(status);
        }
    }

    static int index(String stage) {
        return switch (stage) {
            case "DETECT" -> -1;
            case "DIGEST" -> 0;
            case "PLAN" -> 1;
            case "WRITE" -> 2;
            case "RETRY" -> 3;
            case "LINK" -> 4;
            case "VALIDATE", "REPORT" -> 5;
            case "PUBLISH" -> 6;
            default -> 7;   // DONE
        };
    }

    public static KbProgressResponse compute(Run run, List<Row> rows, List<Job> jobs, int concurrency,
                                             OffsetDateTime now) {
        Map<String, List<Row>> byStage = rows.stream().collect(Collectors.groupingBy(Row::stage, LinkedHashMap::new,
            Collectors.toList()));
        // Where the run is (failed/cancelled runs: the stage they stopped at).
        int cur = index(run.stage());
        boolean ended = !run.active();
        boolean succeeded = run.status().equals("SUCCEEDED") || run.status().equals("PARTIAL");
        if (succeeded) cur = 7;

        var stages = new ArrayList<KbProgressResponse.Stage>();
        long wDone = 0;
        long wTotal = 0;
        int writeRows = byStage.getOrDefault("WRITE", List.of()).size();
        for (var s : STAGES) {
            int i = index(s);
            var list = byStage.getOrDefault(s, List.of());
            var stageJobs = jobs.stream().filter(j -> j.stage().equals(s)).toList();
            var batchJob = stageJobs.stream().filter(j -> j.mode().equals("BATCH"))
                .max(Comparator.comparing(j -> j.submittedAt() == null ? OffsetDateTime.MAX : j.submittedAt()))
                .orElse(null);
            String mode = stageJobs.isEmpty() ? null : stageJobs.get(stageJobs.size() - 1).mode().toLowerCase();
            boolean openBatch = stageJobs.stream().anyMatch(Job::open);

            Integer total;
            int done;
            int failed;
            int inFlight;
            if (LLM.contains(s)) {
                if (!list.isEmpty()) {
                    total = list.size();
                    done = (int) list.stream().filter(r -> r.status().equals("DONE")).count();
                    failed = (int) list.stream().filter(Row::failed).count();
                    inFlight = (int) list.stream().filter(Row::inFlight).count();
                } else {
                    total = s.equals("PLAN") && i >= cur && !ended ? Integer.valueOf(run.expectedPlan())
                        : (i < cur || ended) ? Integer.valueOf(0) : null;
                    if (s.equals("DIGEST") && i >= cur && !ended) total = null;
                    done = 0;
                    failed = 0;
                    inFlight = 0;
                }
                // Batch stages: DO's request_counts while the batch is open.
                if (openBatch && batchJob != null && batchJob.countTotal() != null) {
                    total = Math.max(total == null ? 0 : total, batchJob.countTotal());
                    done = batchJob.countCompleted() == null ? done : batchJob.countCompleted();
                    failed = batchJob.countFailed() == null ? failed : batchJob.countFailed();
                    inFlight = Math.max(0, total - done - failed);
                }
            } else if (s.equals("PUBLISH")) {
                total = run.eval() || run.dryRun() ? Integer.valueOf(0) : Integer.valueOf(run.publishTotal());
                done = run.publishDone();
                failed = run.publishFailed();
                inFlight = 0;
            } else {
                // LINK / VALIDATE: the written pages, linked and validated in code.
                total = writeRows > 0 || cur > index("WRITE") ? Integer.valueOf(writeRows) : null;
                boolean through = cur > index("WRITE") && !(s.equals("VALIDATE") && run.stage().equals("REPORT"));
                done = through ? writeRows : 0;
                failed = 0;
                inFlight = 0;
            }

            // Sync jobs mark every row submitted up front; only `concurrency`
            // of them are actually in flight, the rest are queued.
            if (!openBatch && "sync".equals(mode)) inFlight = Math.min(inFlight, concurrency);
            if (ended) inFlight = 0;   // abandoned when the run ended

            String status;
            boolean skippable = (run.eval() && s.equals("PUBLISH")) || (run.dryRun() && i > index("PLAN"));
            if (skippable) status = "skipped";
            else if (succeeded) status = (total != null && total == 0) ? "skipped" : "done";
            else if (i < cur) status = (total != null && total == 0) ? "skipped" : "done";
            else if (i == cur || (s.equals("VALIDATE") && run.stage().equals("REPORT"))) {
                if (ended) status = "failed";
                else if (openBatch) status = "waiting_batch";
                else status = "running";
            } else status = ended ? "skipped" : "pending";
            if (s.equals("LINK") && run.stage().equals("REPORT")) status = "done";

            var log = run.stageLog() == null ? null : run.stageLog().path(s);
            var startedAt = time(log, "startedAt");
            if (startedAt == null && !list.isEmpty()) {
                startedAt = list.stream().map(Row::createdAt).filter(Objects::nonNull).min(Comparator.naturalOrder()).orElse(null);
            }
            var finishedAt = time(log, "finishedAt");
            if (finishedAt == null && (status.equals("done") || status.equals("failed")) && !list.isEmpty()) {
                finishedAt = list.stream().map(Row::completedAt).filter(Objects::nonNull).max(Comparator.naturalOrder())
                    .orElse(null);
            }
            if (s.equals("VALIDATE") || s.equals("LINK")) {
                var w = run.stageLog() == null ? null : run.stageLog().path("WRITE");
                if (startedAt == null && status.equals("done")) startedAt = time(w, "finishedAt");
                if (finishedAt == null && status.equals("done")) finishedAt = startedAt;
            }
            var batch = batchJob == null ? null : new KbProgressResponse.Batch(batchJob.doStatus(),
                batchJob.countTotal() == null ? null : new KbProgressResponse.RequestCounts(batchJob.countTotal(),
                    nz(batchJob.countCompleted()), nz(batchJob.countFailed())), batchJob.submittedAt(),
                batchJob.status(), batchJob.error(), batchJob.nextAttemptAt());
            stages.add(new KbProgressResponse.Stage(s, status, total, done, failed, inFlight,
                LLM.contains(s) ? mode : null, batch, startedAt, finishedAt));

            // Weighting (LLM stages only; code stages are instant).
            if (LLM.contains(s) && !status.equals("skipped")) {
                long[] w = weight(s, list, total, done + failed, status, run, byStage);
                wDone += w[0];
                wTotal += w[1];
            }
        }
        if (succeeded) wDone = wTotal;
        double percent = wTotal == 0 ? (succeeded ? 100 : 0) : Math.min(100, Math.round(wDone * 1000.0 / wTotal) / 10.0);
        var overall = new KbProgressResponse.Overall(wDone, wTotal, percent);

        var lastActivity = lastActivity(run, rows, jobs);
        var currentStage = stages.stream().filter(x -> x.status().equals("running") || x.status().equals("waiting_batch"))
            .findFirst().orElse(null);
        boolean batchWait = currentStage != null && currentStage.status().equals("waiting_batch");
        boolean stalled = run.active() && !run.status().equals("BLOCKED_BY_COST_LIMIT") && lastActivity != null
            && Duration.between(lastActivity, now).compareTo(batchWait ? BATCH_STALL : SYNC_STALL) > 0;
        Long eta = run.active() && !batchWait && !run.status().equals("BLOCKED_BY_COST_LIMIT")
            ? eta(rows, stages, run, byStage, concurrency) : null;
        return new KbProgressResponse(stages, overall, current(run, currentStage, byStage, jobs), eta, lastActivity,
            stalled);
    }

    // {done, total} in estimated tokens for one LLM stage.
    static long[] weight(String s, List<Row> list, Integer total, int finished, String status, Run run,
                         Map<String, List<Row>> byStage) {
        if (!list.isEmpty()) {
            long all = list.stream().mapToLong(Row::estTokens).sum();
            long fin = list.stream().filter(Row::finished).mapToLong(Row::estTokens).sum();
            // Batch counts may run ahead of the rows (recorded when collected).
            if (total != null && total > 0 && finished > list.stream().filter(Row::finished).count()) {
                fin = all * Math.min(finished, total) / total;
            }
            return new long[]{fin, all};
        }
        int per = DEFAULT_TOKENS.get(s);
        long expected = switch (s) {
            case "PLAN" -> (long) run.expectedPlan() * per;
            case "WRITE" -> (long) Math.max(1, planCount(run, byStage)) * PAGES_PER_PLAN * per;
            case "RETRY" -> (long) Math.ceil(estimatedWrites(run, byStage) * RETRY_SHARE) * per;
            default -> total == null ? 0 : (long) total * per;
        };
        return new long[]{0, status.equals("done") ? 0 : expected};
    }

    static int planCount(Run run, Map<String, List<Row>> byStage) {
        var plan = byStage.getOrDefault("PLAN", List.of());
        return plan.isEmpty() ? run.expectedPlan() : plan.size();
    }

    static int estimatedWrites(Run run, Map<String, List<Row>> byStage) {
        var write = byStage.getOrDefault("WRITE", List.of());
        return write.isEmpty() ? planCount(run, byStage) * PAGES_PER_PLAN : write.size();
    }

    // Remaining requests (current and later LLM stages, estimated where
    // unknown) x moving average latency / concurrency. Without latencies,
    // the average gap between the last completions.
    static Long eta(List<Row> rows, List<KbProgressResponse.Stage> stages, Run run, Map<String, List<Row>> byStage,
                    int concurrency) {
        long remaining = 0;
        for (var st : stages) {
            if (!LLM.contains(st.stage())) continue;
            if (st.status().equals("done") || st.status().equals("skipped")) continue;
            if (st.total() != null && !byStage.getOrDefault(st.stage(), List.of()).isEmpty()) {
                remaining += Math.max(0, st.total() - st.done() - st.failed());
            } else if (st.stage().equals("PLAN")) {
                remaining += run.expectedPlan();
            } else if (st.stage().equals("WRITE")) {
                remaining += (long) planCount(run, byStage) * PAGES_PER_PLAN;
            } else if (st.stage().equals("RETRY")) {
                remaining += (long) Math.ceil(estimatedWrites(run, byStage) * RETRY_SHARE);
            }
        }
        if (remaining == 0) return null;
        var finished = rows.stream().filter(r -> r.completedAt() != null)
            .sorted(Comparator.comparing(Row::completedAt).reversed()).limit(LATENCY_WINDOW).toList();
        var latencies = finished.stream().map(Row::latencyMs).filter(Objects::nonNull).toList();
        if (!latencies.isEmpty()) {
            double avgMs = latencies.stream().mapToInt(Integer::intValue).average().orElse(0);
            return Math.round(remaining * avgMs / 1000.0 / Math.max(1, Math.min(concurrency, remaining)));
        }
        if (finished.size() >= 2) {
            var first = finished.get(finished.size() - 1).completedAt();
            var last = finished.get(0).completedAt();
            double gapSec = Duration.between(first, last).toMillis() / 1000.0 / (finished.size() - 1);
            return Math.round(remaining * gapSec);
        }
        return null;
    }

    static OffsetDateTime lastActivity(Run run, List<Row> rows, List<Job> jobs) {
        var times = new ArrayList<OffsetDateTime>();
        times.add(run.startedAt());
        rows.forEach(r -> times.add(r.completedAt()));
        jobs.forEach(j -> {
            times.add(j.submittedAt());
            times.add(j.statusChangedAt());
            times.add(j.completedAt());
        });
        if (run.stageLog() != null) {
            run.stageLog().forEach(n -> {
                times.add(time(n, "startedAt"));
                times.add(time(n, "finishedAt"));
            });
        }
        return times.stream().filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
    }

    static final java.time.format.DateTimeFormatter HH_MM = java.time.format.DateTimeFormatter.ofPattern("HH:mm");

    static String current(Run run, KbProgressResponse.Stage st, Map<String, List<Row>> byStage) {
        return current(run, st, byStage, List.of());
    }

    static String current(Run run, KbProgressResponse.Stage st, Map<String, List<Row>> byStage, List<Job> jobs) {
        switch (run.status()) {
            case "SUCCEEDED" -> { return "Terminado"; }
            case "PARTIAL" -> { return "Terminado con fallas" + (run.error() == null ? "" : ": " + run.error()); }
            case "CANCELLED" -> { return "Cancelado"; }
            case "FAILED" -> { return "Falló en " + stageName(run.stage()) + (run.error() == null ? "" : ": " + run.error()); }
            case "BLOCKED_BY_COST_LIMIT" -> { return "Bloqueado por el límite de costo semanal: requiere aprobación"; }
            default -> { }
        }
        if (run.stage().equals("DETECT")) return run.eval() ? "Preparando la evaluación" : "Detectando cambios";
        if (run.stage().equals("REPORT")) return "Calculando las métricas de la evaluación";
        if (st == null) return stageName(run.stage());
        if (!LLM.contains(st.stage())) return stageName(st.stage());
        var line = new StringBuilder(stageName(st.stage()));
        line.append(" (").append(st.done() + st.failed()).append('/')
            .append(st.total() == null ? "por determinar" : st.total()).append(')');
        var models = models(byStage.getOrDefault(st.stage(), List.of()), r -> true);
        if (!models.isEmpty()) line.append(" con ").append(models);
        if (st.status().equals("waiting_batch")) {
            var limited = jobs.stream().filter(j -> j.stage().equals(st.stage()) && j.rateLimited())
                .map(Job::nextAttemptAt).min(Comparator.naturalOrder()).orElse(null);
            if (limited != null) {
                var at = limited.atZoneSameInstant(org.ceitba.api.config.ClockConfig.ZONE).format(HH_MM);
                boolean rate = jobs.stream().anyMatch(j -> j.stage().equals(st.stage()) && j.rateLimited()
                    && j.error().startsWith("RATE_LIMITED"));
                line.append(rate ? ": DigitalOcean limitó la creación de lotes; reintento a las "
                    : ": DigitalOcean no respondió al crear el lote; reintento a las ").append(at);
            } else {
                line.append(": esperando el lote de DigitalOcean");
            }
        }
        return line.toString();
    }

    static String stageName(String stage) {
        return switch (stage) {
            case "DIGEST" -> "Generando resúmenes de archivos";
            case "PLAN" -> "Planificando las páginas";
            case "WRITE" -> "Escribiendo páginas";
            case "RETRY" -> "Corrigiendo páginas rechazadas";
            case "LINK" -> "Enlazando páginas";
            case "VALIDATE" -> "Validando páginas";
            case "PUBLISH" -> "Publicando";
            case "REPORT" -> "Calculando las métricas de la evaluación";
            case "DETECT" -> "Detectando cambios";
            default -> stage;
        };
    }

    // "a", "a y b", "a, b y c" by request count.
    static String models(List<Row> rows, Predicate<Row> filter) {
        var counts = rows.stream().filter(filter).collect(Collectors.groupingBy(Row::model, LinkedHashMap::new,
            Collectors.counting()));
        var names = counts.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .map(Map.Entry::getKey).toList();
        if (names.size() <= 1) return names.isEmpty() ? "" : names.get(0);
        return String.join(", ", names.subList(0, names.size() - 1)) + " y " + names.get(names.size() - 1);
    }

    // {done, total, percent} of a subset of rows (an eval configuration),
    // with the same weighting; unknown stages estimated per configuration.
    public static KbProgressResponse.Overall subset(List<Row> rows, Run run, int expectedPlan) {
        long done = 0;
        long total = 0;
        var byStage = rows.stream().collect(Collectors.groupingBy(Row::stage));
        var cfgRun = new Run(run.eval(), run.stage(), run.status(), run.dryRun(), run.startedAt(), run.finishedAt(),
            run.stageLog(), expectedPlan, 0, 0, 0, run.error());
        boolean completed = run.status().equals("SUCCEEDED") || run.status().equals("PARTIAL");
        int cur = completed ? 7 : index(run.stage());
        for (var s : List.of("PLAN", "WRITE", "RETRY")) {
            var list = byStage.getOrDefault(s, List.of());
            if (list.isEmpty() && (index(s) < cur || !run.active())) continue;   // passed with nothing
            var w = weight(s, list, list.isEmpty() ? null : list.size(),
                (int) list.stream().filter(Row::finished).count(), "pending", cfgRun, byStage);
            done += w[0];
            total += w[1];
        }
        if (completed) done = total;
        double percent = total == 0 ? (completed ? 100 : 0)
            : Math.min(100, Math.round(done * 1000.0 / total) / 10.0);
        return new KbProgressResponse.Overall(done, total, percent);
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    static OffsetDateTime time(JsonNode n, String field) {
        if (n == null || !n.path(field).isTextual()) return null;
        try {
            return OffsetDateTime.parse(n.path(field).asText());
        } catch (Exception e) {
            return null;
        }
    }
}
