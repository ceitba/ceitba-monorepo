package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.kb.KbLlmUsage;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbFileDigestRepository;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.service.kb.pipeline.KbInputs;
import org.ceitba.api.service.kb.pipeline.KbPayloads;
import org.ceitba.api.web.kb.admin.KbForecastResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Expected costs (docs/SUBJECT-WIKI-ADMIN.md §7), for the current or proposed
// settings. All prices are effective prices: batch-discounted when the stage
// would run in BATCH.
//   nextRun     the pipeline preview (dirty subjects, real sizes) priced;
//               input = chars / 3.5 plus prompt overhead; output = the median
//               output tokens per request learned per (model, stage), else
//               600 / 1500 / 2500 / 2500 (DIGEST / PLAN / WRITE / RETRY)
//   weekly      basis history (>= 3 completed scheduled runs: median run
//               re-priced, p25-p75, times the scheduled runs per week from
//               the cron), corpus (no run: weekly changed files x tokens per
//               file, range x0.5-x1.5) or blend (1-2 runs, weighted runs/3)
//   monthly     weekly x 4.345
//   fullRebuild every wiki regenerated from its digests (PLAN + WRITE)
//   savings     for the typical week: batch (vs list price) and cache (vs
//               uncached input)
@Service
public class KbForecastService {

    static final Map<String, Integer> DEFAULT_OUTPUT = Map.of("DIGEST", 600, "PLAN", 1500, "WRITE", 2500, "RETRY", 2500);
    static final List<String> STAGES = List.of("DIGEST", "PLAN", "WRITE", "RETRY");
    static final BigDecimal WEEKS_PER_MONTH = new BigDecimal("4.345");
    // Prompt overhead per request (rules, tool schema, framing), in tokens.
    // Anthropic models count more tool-schema overhead than GLM (observed
    // 752 vs 240 prompt tokens for the same tiny probe): rough average.
    static final int OVERHEAD = 1500;
    static final int DIGEST_TOKENS_PER_FILE = 800;

    private final KbInputs inputs;
    private final KbFileDigestRepository digests;
    private final KbPageRepository pages;
    private final KbRunRepository runs;
    private final KbRunRequestRepository requests;
    private final KbLlmUsageRepository usage;
    private final KbModelRepository models;
    private final DriveFileRepository files;
    private final KbLlmRouter router;
    private final ObjectMapper json;
    private final Clock clock;

    public KbForecastService(KbInputs inputs, KbFileDigestRepository digests, KbPageRepository pages,
                             KbRunRepository runs, KbRunRequestRepository requests, KbLlmUsageRepository usage,
                             KbModelRepository models, DriveFileRepository files, KbLlmRouter router,
                             ObjectMapper json, Clock clock) {
        this.inputs = inputs;
        this.digests = digests;
        this.pages = pages;
        this.runs = runs;
        this.requests = requests;
        this.usage = usage;
        this.models = models;
        this.files = files;
        this.router = router;
        this.json = json;
        this.clock = clock;
    }

    // One priced line of a token profile.
    record Line(String stage, String model, String mode, long input, long cached, long output) {}

    // What a forecast reads from the database, read once per forecast (no
    // page bodies): inputs, their diffs (every subject; paused ones are
    // filtered per settings), live page sources per subject, the catalog
    // and the learned ratios.
    record Snapshot(Map<String, List<KbInputs.Input>> current, List<KbInputs.Diff> diffs,
                    Map<String, List<UUID[]>> liveSources, Map<String, KbModel> catalog,
                    Map<String, Integer> ratios, Map<String, Double> cacheRatios) {

        int pageCount(String subjectId) {
            return liveSources.getOrDefault(subjectId, List.of()).size();
        }

        List<KbInputs.Diff> dirty(KbEffectiveSettings s) {
            return diffs.stream().filter(d -> d.dirty() && !s.paused(d.subjectId())).toList();
        }
    }

    // stage-cost is asked for every (model, stage) of the admin table at
    // once: those calls share one snapshot for a few seconds.
    static final java.time.Duration SNAPSHOT_TTL = java.time.Duration.ofSeconds(30);
    private volatile Snapshot memo;
    private volatile long memoAt;

    private Snapshot snapshot() {
        var current = inputs.current();
        Map<String, List<UUID[]>> sources = new HashMap<>();
        for (Object[] r : pages.findSubjectSources(List.of(KbPageStatus.PUBLISHED, KbPageStatus.HIDDEN))) {
            sources.computeIfAbsent((String) r[0], k -> new ArrayList<>()).add(r[1] == null ? new UUID[0] : (UUID[]) r[1]);
        }
        return new Snapshot(current, inputs.diffs(id -> false, current), sources, catalog(), outputRatios(),
            cacheRatios());
    }

    private Snapshot memoSnapshot() {
        var m = memo;
        long now = System.nanoTime();
        if (m != null && now - memoAt < SNAPSHOT_TTL.toNanos()) return m;
        m = snapshot();
        memo = m;
        memoAt = now;
        return m;
    }

    @Transactional(readOnly = true)
    public KbForecastResponse forecast(KbEffectiveSettings s) {
        return forecast(s, snapshot());
    }

    private KbForecastResponse forecast(KbEffectiveSettings s, Snapshot snap) {
        var catalog = snap.catalog();
        var ratios = snap.ratios();
        var cacheRatios = snap.cacheRatios();

        var next = nextRunLines(s, snap, ratios, cacheRatios);
        var nextStages = perStage(next, s, catalog);
        var nextTotal = total(next, catalog);

        // weekly
        var history = historyCosts(s, catalog);
        var corpusLines = corpusLines(s, snap, ratios, cacheRatios);
        var corpus = total(corpusLines, catalog);
        var basis = basis(history.size());
        var hist = quantiles(history);
        // History is per run: a week has as many runs as the cron fires.
        var perWeek = BigDecimal.valueOf(runsPerWeek(s.cron(), OffsetDateTime.now(clock)));
        for (int i = 0; i < hist.length; i++) hist[i] = hist[i].multiply(perWeek);
        BigDecimal expected;
        BigDecimal low;
        BigDecimal high;
        switch (basis) {
            case "history" -> {
                expected = hist[1];
                low = hist[0];
                high = hist[2];
            }
            case "corpus" -> {
                expected = corpus;
                low = corpus.multiply(new BigDecimal("0.5"));
                high = corpus.multiply(new BigDecimal("1.5"));
            }
            default -> {
                var w = BigDecimal.valueOf(history.size()).divide(BigDecimal.valueOf(3), 6, RoundingMode.HALF_UP);
                expected = blend(hist[1], corpus, w);
                low = blend(hist[0], corpus.multiply(new BigDecimal("0.5")), w);
                high = blend(hist[2], corpus.multiply(new BigDecimal("1.5")), w);
            }
        }
        int dirty = snap.dirty(s).size();
        var floor = dirty > 0 ? nextTotal : BigDecimal.ZERO;
        var monthly = new KbForecastResponse.Range(usd(expected.multiply(WEEKS_PER_MONTH).max(floor)),
            usd(low.multiply(WEEKS_PER_MONTH).max(floor)), usd(high.multiply(WEEKS_PER_MONTH).max(floor)));
        var weekly = weekly(expected, low, high, floor, basis, history.size());

        var rebuild = rebuildLines(s, snap, ratios, cacheRatios);
        long rebuildIn = rebuild.stream().mapToLong(Line::input).sum();
        long rebuildOut = rebuild.stream().mapToLong(Line::output).sum();
        var fullRebuild = new KbForecastResponse.Tokens(rebuildIn, rebuildOut, usd(total(rebuild, catalog)));

        // Savings on the typical week's profile (history if any, else corpus).
        var profile = history.isEmpty() ? corpusLines : historyProfile(s, catalog);
        var actual = total(profile, catalog);
        var noBatch = BigDecimal.ZERO;
        var noCache = BigDecimal.ZERO;
        for (var l : profile) {
            var m = catalog.get(l.model());
            noBatch = noBatch.add(KbPricing.cost(m, "SYNC", l.input(), l.cached(), l.output()));
            noCache = noCache.add(KbPricing.cost(m, l.mode(), l.input(), 0, l.output()));
        }
        var savings = new KbForecastResponse.Savings(usd(noBatch.subtract(actual).max(BigDecimal.ZERO)),
            usd(noCache.subtract(actual).max(BigDecimal.ZERO)));

        var limit = s.weeklyCostLimitUsd();
        boolean exceeds = limit != null && (nextTotal.compareTo(limit) > 0 || weekly.expectedUsd().compareTo(limit) > 0);
        boolean discountIsEstimate = STAGES.stream().anyMatch(st -> {
            var model = stageModel(s, st, null);
            var m = catalog.get(model);
            return "BATCH".equals(router.modeFor(model, s.executionMode())) && (m == null || !m.isBatchDiscountVerified());
        });
        return new KbForecastResponse(settingsHash(s),
            new KbForecastResponse.NextRun(dirty, nextStages, usd(nextTotal)), weekly, monthly, fullRebuild, savings,
            new KbForecastResponse.Limits(limit, exceeds), discountIsEstimate);
    }

    // GET /models/{id}/stage-cost (ADMIN doc §8): the weekly forecast with
    // `model` in `stage`, every other setting as `s`.
    @Transactional(readOnly = true)
    public org.ceitba.api.web.kb.admin.KbStageCostResponse stageCost(KbEffectiveSettings s, String model, String stage) {
        var weekly = forecast(s, memoSnapshot()).weekly();
        var mode = router.modeFor(model, s.executionMode()).toLowerCase(java.util.Locale.ROOT);
        return new org.ceitba.api.web.kb.admin.KbStageCostResponse(stage.toLowerCase(java.util.Locale.ROOT), model, mode,
            weekly.expectedUsd(), weekly.low(), weekly.high(), weekly.basis());
    }

    // The forecast's next-run total (stored on a run when it is detected).
    @Transactional(readOnly = true)
    public BigDecimal nextRunTotal(KbEffectiveSettings s) {
        var snap = snapshot();
        return usd(total(nextRunLines(s, snap, snap.ratios(), snap.cacheRatios()), snap.catalog()));
    }

    // Scheduled runs in the 7 days from `from` (at least 1; an invalid cron
    // counts as one run).
    static int runsPerWeek(String cron, OffsetDateTime from) {
        if (cron == null || !org.springframework.scheduling.support.CronExpression.isValidExpression(cron)) return 1;
        var expr = org.springframework.scheduling.support.CronExpression.parse(cron);
        var t = from.atZoneSameInstant(org.ceitba.api.config.ClockConfig.ZONE);
        var end = t.plusDays(7);
        int n = 0;
        while (n < 7 * 24 * 60) {
            t = expr.next(t);
            if (t == null || !t.isBefore(end)) break;
            n++;
        }
        return Math.max(1, n);
    }

    // A week can't cost less than the pending backlog (`floor`, the next
    // run's total when there are dirty subjects): the range is raised to it
    // and includesBacklog set; basis stays the estimate's.
    static KbForecastResponse.Weekly weekly(BigDecimal expected, BigDecimal low, BigDecimal high, BigDecimal floor,
                                            String basis, int runs) {
        boolean backlog = floor.signum() > 0 && expected.compareTo(floor) < 0;
        return new KbForecastResponse.Weekly(usd(expected.max(floor)), usd(low.max(floor)), usd(high.max(floor)), basis,
            runs, backlog);
    }

    // ---- basis ----------------------------------------------------------------------

    // history with >= 3 runs, corpus with none, blend in between.
    public static String basis(int runs) {
        if (runs >= 3) return "history";
        if (runs == 0) return "corpus";
        return "blend";
    }

    static BigDecimal blend(BigDecimal history, BigDecimal corpus, BigDecimal historyWeight) {
        return history.multiply(historyWeight).add(corpus.multiply(BigDecimal.ONE.subtract(historyWeight)));
    }

    // p25, median, p75 (zeros when empty).
    static BigDecimal[] quantiles(List<BigDecimal> values) {
        if (values.isEmpty()) return new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
        var sorted = new ArrayList<>(values);
        sorted.sort(null);
        return new BigDecimal[]{quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)};
    }

    private static BigDecimal quantile(List<BigDecimal> sorted, double q) {
        double pos = q * (sorted.size() - 1);
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        var frac = BigDecimal.valueOf(pos - lo);
        return sorted.get(lo).add(sorted.get(hi).subtract(sorted.get(lo)).multiply(frac));
    }

    // ---- token profiles -------------------------------------------------------------

    private List<Line> nextRunLines(KbEffectiveSettings s, Snapshot snap, Map<String, Integer> ratios,
                                    Map<String, Double> cache) {
        var lines = new ArrayList<Line>();
        var dirty = snap.dirty(s);
        var fps = new HashSet<String>();
        dirty.forEach(d -> {
            d.added().forEach(i -> fps.add(fp(i)));
            d.changed().forEach(i -> fps.add(fp(i)));
        });
        var known = new HashSet<String>();
        if (!fps.isEmpty()) {
            digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
                .forEach(dg -> known.add(dg.getContentFingerprint()));
        }
        var planned = new HashSet<String>();
        for (var d : dirty) {
            var subject = d.subjectId();
            long changedChars = 0;
            int changedFiles = 0;
            for (var list : List.of(d.added(), d.changed())) {
                for (var i : list) {
                    changedChars += i.chars();
                    changedFiles++;
                    var f = fp(i);
                    if (known.contains(f) || !planned.add(f)) continue;
                    int chunks = (int) Math.max(1, Math.ceil(i.chars() / (double) KbPayloads.CHUNK_CHARS));
                    lines.add(line(s, "DIGEST", null, chunks, (long) (i.chars() / 3.5) + (long) OVERHEAD * chunks,
                        ratios, cache));
                }
            }
            var live = snap.liveSources().getOrDefault(subject, List.of());
            int pageCount = live.size();
            lines.add(line(s, "PLAN", subject, 1,
                OVERHEAD + 150L * pageCount + (long) DIGEST_TOKENS_PER_FILE * changedFiles + 1500, ratios, cache));
            var touchedIds = new HashSet<UUID>();
            d.changed().forEach(i -> touchedIds.add(i.fileId()));
            touchedIds.addAll(d.removed());
            long citing = live.stream().filter(src -> java.util.Arrays.stream(src).anyMatch(touchedIds::contains)).count();
            int writes = (int) (citing + (d.added().isEmpty() ? 0 : Math.max(1, d.added().size() / 2))
                + (pageCount == 0 ? 1 : 0));
            if (writes == 0) continue;
            long excerpts = Math.min(12_000, (long) (changedChars / 3.5));
            long perWrite = OVERHEAD + 1500 + 100L * pageCount + excerpts + 800L * Math.min(changedFiles, 5) + 2000;
            lines.add(line(s, "WRITE", subject, writes, perWrite * writes, ratios, cache));
            int retries = (int) Math.ceil(writes * 0.15);
            lines.add(line(s, "RETRY", subject, retries, (perWrite + 4000) * retries, ratios, cache));
        }
        return lines;
    }

    // Weekly change rate of published files (drive modifiedTime in the last 28
    // days / 4) x the average tokens per file, as one week of runs.
    private List<Line> corpusLines(KbEffectiveSettings s, Snapshot snap, Map<String, Integer> ratios,
                                   Map<String, Double> cache) {
        var current = snap.current();
        long fileCount = 0;
        long chars = 0;
        for (var list : current.values()) {
            for (var i : list) {
                fileCount++;
                chars += i.chars();
            }
        }
        if (fileCount == 0) return List.of();
        double avgTokens = chars / 3.5 / fileCount;
        long changed = files.countPublishedModifiedSince(OffsetDateTime.now(clock).minusDays(28));
        double perWeek = changed / 4.0;
        if (perWeek <= 0) return List.of();
        int n = (int) Math.ceil(perWeek);
        var lines = new ArrayList<Line>();
        lines.add(line(s, "DIGEST", null, n, (long) ((avgTokens + OVERHEAD) * n), ratios, cache));
        lines.add(line(s, "PLAN", null, n, (long) (OVERHEAD + 3000 + DIGEST_TOKENS_PER_FILE) * n, ratios, cache));
        lines.add(line(s, "WRITE", null, n, (long) ((OVERHEAD + 5000 + Math.min(12_000, avgTokens)) * n), ratios, cache));
        int retries = (int) Math.ceil(n * 0.15);
        lines.add(line(s, "RETRY", null, retries, (long) ((OVERHEAD + 9000 + Math.min(12_000, avgTokens)) * retries),
            ratios, cache));
        return lines;
    }

    // Every wiki regenerated from its digests.
    private List<Line> rebuildLines(KbEffectiveSettings s, Snapshot snap, Map<String, Integer> ratios,
                                    Map<String, Double> cache) {
        var lines = new ArrayList<Line>();
        for (var e : snap.current().entrySet()) {
            int fileCount = e.getValue().size();
            long chars = e.getValue().stream().mapToLong(KbInputs.Input::chars).sum();
            int pageCount = Math.max(fileCount + 1, snap.pageCount(e.getKey()));
            lines.add(line(s, "PLAN", e.getKey(), 1, OVERHEAD + 1500 + (long) DIGEST_TOKENS_PER_FILE * fileCount,
                ratios, cache));
            long perWrite = OVERHEAD + 1500 + 100L * pageCount + Math.min(12_000, (long) (chars / 3.5 / pageCount))
                + 2400;
            lines.add(line(s, "WRITE", e.getKey(), pageCount, perWrite * pageCount, ratios, cache));
        }
        return lines;
    }

    private Line line(KbEffectiveSettings s, String stage, String subjectId, int requestCount, long input,
                      Map<String, Integer> ratios, Map<String, Double> cache) {
        var model = stageModel(s, stage, subjectId);
        var mode = router.modeFor(model, s.executionMode());
        long output = (long) ratios.getOrDefault(model + "|" + stage, DEFAULT_OUTPUT.get(stage)) * requestCount;
        long cached = (long) (input * cache.getOrDefault(model, 0.0));
        return new Line(stage, model, mode, input, cached, output);
    }

    static String stageModel(KbEffectiveSettings s, String stage, String subjectId) {
        return switch (stage) {
            case "DIGEST" -> s.modelDigest();
            case "PLAN" -> subjectId == null ? s.modelPlan() : s.planModelFor(subjectId);
            case "RETRY" -> subjectId == null ? s.modelRetry() : s.retryModelFor(subjectId);
            default -> subjectId == null ? s.modelWrite() : s.writeModelFor(subjectId);
        };
    }

    private Map<String, KbForecastResponse.Stage> perStage(List<Line> lines, KbEffectiveSettings s,
                                                           Map<String, KbModel> catalog) {
        Map<String, KbForecastResponse.Stage> out = new LinkedHashMap<>();
        for (var st : STAGES) {
            long in = 0;
            long cached = 0;
            long outTokens = 0;
            var cost = BigDecimal.ZERO;
            for (var l : lines) {
                if (!l.stage().equals(st)) continue;
                in += l.input();
                cached += l.cached();
                outTokens += l.output();
                cost = cost.add(KbPricing.cost(catalog.get(l.model()), l.mode(), l.input(), l.cached(), l.output()));
            }
            var model = stageModel(s, st, null);
            out.put(st, new KbForecastResponse.Stage(model, router.modeFor(model, s.executionMode()).toLowerCase(),
                in, cached, outTokens, usd(cost)));
        }
        return out;
    }

    private static BigDecimal total(List<Line> lines, Map<String, KbModel> catalog) {
        var t = BigDecimal.ZERO;
        for (var l : lines) t = t.add(KbPricing.cost(catalog.get(l.model()), l.mode(), l.input(), l.cached(), l.output()));
        return t;
    }

    // ---- history ----------------------------------------------------------------------

    private List<KbRun> recentScheduled() {
        return runs.findByTriggerNotOrderByStartedAtDesc("EVAL", PageRequest.of(0, 50)).stream()
            .filter(r -> r.getTrigger().equals("SCHEDULED") && org.ceitba.api.service.kb.pipeline.KbRunOutcome.completed(r.getStatus()))
            .limit(8)
            .toList();
    }

    // Each recent scheduled run's recorded usage, re-priced with `s`.
    private List<BigDecimal> historyCosts(KbEffectiveSettings s, Map<String, KbModel> catalog) {
        var recent = recentScheduled();
        if (recent.isEmpty()) return List.of();
        Map<UUID, BigDecimal> byRun = new LinkedHashMap<>();
        recent.forEach(r -> byRun.put(r.getId(), BigDecimal.ZERO));
        for (var u : usage.findByRunIdIn(byRun.keySet())) {
            var l = reprice(u, s);
            byRun.merge(u.getRunId(), KbPricing.cost(catalog.get(l.model()), l.mode(), l.input(), l.cached(), l.output()),
                BigDecimal::add);
        }
        return List.copyOf(byRun.values());
    }

    // The token profile of the median recent scheduled run, re-priced with `s`.
    private List<Line> historyProfile(KbEffectiveSettings s, Map<String, KbModel> catalog) {
        var recent = recentScheduled();
        if (recent.isEmpty()) return List.of();
        Map<UUID, List<Line>> byRun = new HashMap<>();
        for (var u : usage.findByRunIdIn(recent.stream().map(KbRun::getId).toList())) {
            byRun.computeIfAbsent(u.getRunId(), k -> new ArrayList<>()).add(reprice(u, s));
        }
        var ranked = new ArrayList<>(byRun.values());
        ranked.sort((a, b) -> total(a, catalog).compareTo(total(b, catalog)));
        return ranked.isEmpty() ? List.of() : ranked.get(ranked.size() / 2);
    }

    private Line reprice(KbLlmUsage u, KbEffectiveSettings s) {
        var model = stageModel(s, u.getStage(), u.getSubjectId());
        return new Line(u.getStage(), model, router.modeFor(model, s.executionMode()), u.getInputTokens(),
            u.getCachedInputTokens(), u.getOutputTokens());
    }

    // ---- learned ratios -----------------------------------------------------------------

    // Median output tokens per request, per "model|stage", over recent answers.
    private Map<String, Integer> outputRatios() {
        Map<String, List<Integer>> samples = new HashMap<>();
        for (Object[] r : requests.recentOutputTokens(OffsetDateTime.now(clock).minusDays(90))) {
            samples.computeIfAbsent(r[0] + "|" + r[1], k -> new ArrayList<>()).add(((Number) r[2]).intValue());
        }
        Map<String, Integer> out = new HashMap<>();
        samples.forEach((k, v) -> {
            v.sort(null);
            out.put(k, v.get(v.size() / 2));
        });
        return out;
    }

    // Share of input tokens served from the provider's cache, per model.
    private Map<String, Double> cacheRatios() {
        Map<String, long[]> acc = new HashMap<>();
        var now = OffsetDateTime.now(clock);
        for (var u : usage.findByCreatedAtBetween(now.minusDays(30), now)) {
            var a = acc.computeIfAbsent(u.getModel(), k -> new long[2]);
            a[0] += u.getInputTokens();
            a[1] += u.getCachedInputTokens();
        }
        Map<String, Double> out = new HashMap<>();
        acc.forEach((k, a) -> out.put(k, a[0] == 0 ? 0 : (double) a[1] / a[0]));
        return out;
    }

    private Map<String, KbModel> catalog() {
        Map<String, KbModel> out = new HashMap<>();
        models.findAll().forEach(m -> out.put(m.getId(), m));
        return out;
    }

    private static String fp(KbInputs.Input i) {
        return i.fingerprint() != null ? i.fingerprint() : "file:" + i.fileId();
    }

    private String settingsHash(KbEffectiveSettings s) {
        try {
            var bytes = json.writeValueAsString(s).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes), 0, 8);
        } catch (Exception e) {
            return "";
        }
    }

    static BigDecimal usd(BigDecimal v) {
        return (v == null ? BigDecimal.ZERO : v).setScale(4, RoundingMode.HALF_UP);
    }
}
