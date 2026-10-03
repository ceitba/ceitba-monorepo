package org.ceitba.api.service.kb.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.kb.KbEval;
import org.ceitba.api.domain.kb.KbEvalRating;
import org.ceitba.api.domain.kb.KbEvalSet;
import org.ceitba.api.domain.kb.KbFileDigest;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.kb.KbPageType;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.domain.kb.KbRunRequest;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbEvalRatingRepository;
import org.ceitba.api.repository.kb.KbEvalRepository;
import org.ceitba.api.repository.kb.KbEvalSetRepository;
import org.ceitba.api.repository.kb.KbFileDigestRepository;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbRelationRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.KbLinker;
import org.ceitba.api.service.kb.KbPageParser;
import org.ceitba.api.service.kb.KbValidator;
import org.ceitba.api.service.kb.KbViews;
import org.ceitba.api.service.kb.KbWikilinks;
import org.ceitba.api.service.kb.admin.KbForecastService;
import org.ceitba.api.service.kb.admin.KbSettingsService;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.service.kb.pipeline.KbDigests;
import org.ceitba.api.service.kb.pipeline.KbInputs;
import org.ceitba.api.service.kb.pipeline.KbPageFiles;
import org.ceitba.api.service.kb.pipeline.KbPayloads;
import org.ceitba.api.service.kb.pipeline.KbPipelineException;
import org.ceitba.api.service.kb.pipeline.KbPipelineService;
import org.ceitba.api.service.kb.pipeline.KbRunEngine;
import org.ceitba.api.service.kb.pipeline.KbRunHandler;
import org.ceitba.api.service.media.ObjectStorage;
import org.ceitba.api.web.kb.admin.KbEvalDtos;
import org.ceitba.api.web.kb.admin.KbSettingsResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

// The evaluation framework (docs/SUBJECT-WIKI-ADMIN.md §4, §6, §8).
//
// Benchmark sets freeze their subjects' inputs: file ids, fingerprints and
// digests in kb_eval_set.frozen_inputs, and each file's text in storage
// (kb/evals/sets/<setId>/<fileId>.txt), so later evals of the set read
// neither Drive nor the live database text. An eval is a kb_run (trigger
// EVAL) run by KbRunEngine through the same executors, as a full rebuild
// per model configuration:
//
//   DETECT -> DIGEST (only digests the set still lacks, once, shared)
//          -> PLAN (config x subject) -> WRITE (config x subject x page)
//          -> RETRY (rejected pages, one round) -> REPORT (metrics, pages
//             stored under kb/evals/<evalId>/<configKey>/<subject>/<slug>.md)
//
// It never publishes. Its tokens are recorded with stage EVAL. It is the
// explicit, staff-triggered exception to the "no re-reading" rule (it only
// re-sends digests and the frozen excerpts).
@Service
public class KbEvalService implements KbRunHandler {

    private static final Logger log = LoggerFactory.getLogger(KbEvalService.class);

    public static final String DEFAULT_SET = "Básico";
    static final List<String> DEFAULT_SUBJECTS = List.of("81.07", "61.81", "93.39");
    static final int SMALL_SAMPLE = 20;
    static final Set<String> EFFORTS = Set.of("low", "medium", "high");

    private final KbEvalSetRepository sets;
    private final KbEvalRepository evals;
    private final KbEvalRatingRepository ratings;
    private final KbRunRepository runs;
    private final KbRunRequestRepository requests;
    private final KbFileDigestRepository digests;
    private final KbLlmUsageRepository usage;
    private final KbModelRepository models;
    private final KbPageRepository pages;
    private final KbViews views;
    private final org.ceitba.api.service.kb.progress.KbProgressService progress;
    private final KbRelationRepository relations;
    private final SubjectRepository subjects;
    private final DriveFileRepository files;
    private final KbInputs inputs;
    private final KbPayloads payloads;
    private final KbRunEngine engine;
    private final KbSettingsService settings;
    private final KbForecastService forecast;
    private final KbLlmRouter router;
    private final ObjectStorage storage;
    private final ApplicationEventPublisher events;
    private final ObjectMapper json;
    private final Clock clock;
    private final Random random = new Random();

    public KbEvalService(KbEvalSetRepository sets, KbEvalRepository evals, KbEvalRatingRepository ratings,
                         KbRunRepository runs, KbRunRequestRepository requests, KbFileDigestRepository digests,
                         KbLlmUsageRepository usage, KbModelRepository models, KbPageRepository pages,
                         KbRelationRepository relations, SubjectRepository subjects, DriveFileRepository files,
                         KbInputs inputs, KbPayloads payloads, KbRunEngine engine, KbSettingsService settings,
                         KbForecastService forecast, KbLlmRouter router, ObjectStorage storage,
                         ApplicationEventPublisher events, ObjectMapper json, Clock clock, KbViews views,
                         org.ceitba.api.service.kb.progress.KbProgressService progress) {
        this.views = views;
        this.progress = progress;
        this.sets = sets;
        this.evals = evals;
        this.ratings = ratings;
        this.runs = runs;
        this.requests = requests;
        this.digests = digests;
        this.usage = usage;
        this.models = models;
        this.pages = pages;
        this.relations = relations;
        this.subjects = subjects;
        this.files = files;
        this.inputs = inputs;
        this.payloads = payloads;
        this.engine = engine;
        this.settings = settings;
        this.forecast = forecast;
        this.router = router;
        this.storage = storage;
        this.events = events;
        this.json = json;
        this.clock = clock;
    }

    // ==== benchmark sets =========================================================

    public List<KbEvalDtos.EvalSet> sets() {
        ensureDefaultSet();
        return engine.inTx(() -> sets.findAllByOrderByCreatedAtAsc().stream().map(this::view).toList());
    }

    // "Básico" (81.07, 61.81, 93.39: large, medium, small), created on first
    // use with the subjects that exist; frozen when created.
    public void ensureDefaultSet() {
        try {
            if (engine.inTx(() -> sets.findByName(DEFAULT_SET).isPresent())) return;
            var existing = engine.inTx(() -> subjects.findAllById(DEFAULT_SUBJECTS).stream().map(Subject::getId).sorted().toList());
            if (existing.isEmpty()) return;
            createSet(DEFAULT_SET, existing, null);
        } catch (RuntimeException e) {
            log.warn("KB eval: default set not created: {}", e.getMessage());
        }
    }

    public KbEvalDtos.EvalSet createSet(String name, List<String> subjectIds, UUID userId) {
        if (name == null || name.isBlank()) throw new ValidationException("name", name, "required");
        if (subjectIds == null || subjectIds.isEmpty()) throw new ValidationException("subjectIds", subjectIds, "required");
        var set = engine.inTx(() -> {
            if (sets.findByName(name.trim()).isPresent()) throw new ResourceAlreadyExistsException("KbEvalSet", name);
            for (var id : subjectIds) {
                if (!subjects.existsById(id)) throw new ValidationException("subjectIds", id, "unknown subject");
            }
            var arr = json.createArrayNode();
            new LinkedHashSet<>(subjectIds).forEach(arr::add);
            return sets.saveAndFlush(new KbEvalSet(name.trim(), arr, userId));
        });
        return refreeze(set.getId());
    }

    // Freezes (again) the subjects' current inputs: ids, fingerprints,
    // digests, and the texts into storage.
    public KbEvalDtos.EvalSet refreeze(UUID setId) {
        var set = engine.inTx(() -> sets.findById(setId)
            .orElseThrow(() -> new ResourceNotFoundException("KbEvalSet", setId.toString())));
        var current = engine.inTx(inputs::current);
        var frozen = json.createObjectNode();
        for (var sid : set.getSubjectIds()) {
            var subjectId = sid.asText();
            var list = current.getOrDefault(subjectId, List.of());
            var texts = engine.inTx(() -> {
                Map<UUID, String> m = new HashMap<>();
                files.findAllById(list.stream().map(KbInputs.Input::fileId).toList())
                    .forEach(f -> m.put(f.getId(), f.getTextContent()));
                return m;
            });
            var arr = frozen.putArray(subjectId);
            for (var i : list) {
                var text = texts.get(i.fileId());
                if (text == null) continue;
                var key = "kb/evals/sets/" + setId + "/" + i.fileId() + ".txt";
                var bytes = text.getBytes(StandardCharsets.UTF_8);
                storage.put(key, "text/plain; charset=utf-8", new ByteArrayInputStream(bytes), bytes.length);
                var fp = fingerprintOf(i.fileId(), i.fingerprint());
                var digest = engine.inTx(() -> digests.findByContentFingerprintInAndPromptVersion(List.of(fp),
                    KbPayloads.PROMPT_VERSION).stream().findFirst().map(KbFileDigest::getId).orElse(null));
                var o = arr.addObject();
                o.put("fileId", i.fileId().toString());
                o.put("fingerprint", fp);
                o.put("name", i.name());
                if (i.academicYear() == null) o.putNull("academicYear"); else o.put("academicYear", i.academicYear());
                o.put("chars", i.chars());
                o.put("textKey", key);
                if (digest == null) o.putNull("digestId"); else o.put("digestId", digest.toString());
            }
        }
        return engine.inTx(() -> {
            var s = sets.findById(setId).orElseThrow();
            s.freeze(frozen, OffsetDateTime.now(clock));
            return view(s);
        });
    }

    private KbEvalDtos.EvalSet view(KbEvalSet s) {
        var ids = new ArrayList<String>();
        s.getSubjectIds().forEach(n -> ids.add(n.asText()));
        List<KbEvalDtos.FrozenSubject> frozen = null;
        if (s.getFrozenInputs() != null) {
            frozen = new ArrayList<>();
            var names = names(ids);
            for (var id : ids) {
                var list = s.getFrozenInputs().path(id);
                long chars = 0;
                var fps = new HashSet<String>();
                for (var f : list) {
                    chars += f.path("chars").asLong();
                    fps.add(f.path("fingerprint").asText());
                }
                var known = new HashSet<String>();
                if (!fps.isEmpty()) {
                    digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
                        .forEach(d -> known.add(d.getContentFingerprint()));
                }
                frozen.add(new KbEvalDtos.FrozenSubject(id, names.get(id), list.size(), chars, fps.size() - known.size()));
            }
        }
        return new KbEvalDtos.EvalSet(s.getId(), s.getName(), ids, s.getCreatedBy(), s.getCreatedAt(), s.getFrozenAt(),
            frozen);
    }

    // ==== creating and reading evals ===========================================

    record Config(String key, String plan, String write, String planEffort, String writeEffort) {

        JsonNode effortNode(ObjectMapper json) {
            if (planEffort == null && writeEffort == null) return null;
            var o = json.createObjectNode();
            if (planEffort != null) o.put("plan", planEffort);
            if (writeEffort != null) o.put("write", writeEffort);
            return o;
        }
    }

    // models: [{plan, write, reasoningEffort?: {plan?, write?}}]; the key is
    // "<plan>[@effort]|<write>[@effort]" (ADMIN doc §8).
    List<Config> configs(JsonNode modelsBody) {
        if (modelsBody == null || !modelsBody.isArray() || modelsBody.isEmpty()) {
            throw new ValidationException("models", modelsBody, "at least one {plan, write}");
        }
        Map<String, Config> out = new LinkedHashMap<>();
        for (var m : modelsBody) {
            var plan = m.isTextual() ? m.asText() : m.path("plan").asText("");
            var write = m.isTextual() ? m.asText() : m.path("write").asText(plan);
            var pe = effort(m.path("reasoningEffort").path("plan"));
            var we = effort(m.path("reasoningEffort").path("write"));
            for (var id : List.of(plan, write)) {
                var model = models.findById(id).orElseThrow(() -> new ValidationException("models", id, "not in the model catalog"));
                if (!model.isEnabled()) throw new ValidationException("models", id, "is disabled in the catalog");
            }
            var key = configKey(plan, pe, write, we);
            out.putIfAbsent(key, new Config(key, plan, write, pe, we));
        }
        return List.copyOf(out.values());
    }

    static String configKey(String plan, String planEffort, String write, String writeEffort) {
        return plan + (planEffort == null ? "" : "@" + planEffort) + "|" + write + (writeEffort == null ? "" : "@" + writeEffort);
    }

    private static String effort(JsonNode n) {
        if (n == null || n.isMissingNode() || n.isNull()) return null;
        var v = n.asText().toLowerCase(Locale.ROOT);
        if (!EFFORTS.contains(v)) throw new ValidationException("reasoningEffort", v, "must be low, medium or high");
        return v;
    }

    private List<Config> configsOf(KbEval eval) {
        var out = new ArrayList<Config>();
        for (var c : eval.getConfigs()) {
            out.add(new Config(c.path("configKey").asText(), c.path("plan").asText(), c.path("write").asText(),
                c.path("reasoningEffort").path("plan").asText(null), c.path("reasoningEffort").path("write").asText(null)));
        }
        return out;
    }

    public KbEvalDtos.Eval create(UUID setId, JsonNode modelsBody, String note, UUID userId) {
        if (!router.available()) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Inference is not configured (KB_LLM_API_KEY)");
        }
        var configs = configs(modelsBody);
        var set = engine.inTx(() -> sets.findById(setId)
            .orElseThrow(() -> new ResourceNotFoundException("KbEvalSet", setId.toString())));
        if (set.getFrozenInputs() == null) refreeze(setId);
        var run = engine.inTx(() -> {
            if (!runs.findByStatusInAndTrigger(KbRunEngine.ACTIVE, "EVAL").isEmpty()) {
                throw new KbPipelineException(KbPipelineException.Reason.EVAL_ACTIVE, "An eval is already running");
            }
            var summary = String.join(",", configs.stream().map(Config::key).toList());
            var r = runs.saveAndFlush(new KbRun("EVAL", false, KbPayloads.PROMPT_VERSION,
                summary.length() > 128 ? summary.substring(0, 125) + "..." : summary, OffsetDateTime.now(clock),
                json.createObjectNode()));
            var arr = json.createArrayNode();
            for (var c : configs) {
                var o = arr.addObject();
                o.put("configKey", c.key());
                o.put("plan", c.plan());
                o.put("write", c.write());
                var e = c.effortNode(json);
                if (e != null) o.set("reasoningEffort", e);
            }
            var results = json.createObjectNode();
            results.putObject("configs");
            evals.save(new KbEval(r.getId(), setId, arr, note, results, userId));
            return r;
        });
        log.info("KB eval {} started on set {} ({} configs)", run.getId(), set.getName(), configs.size());
        events.publishEvent(new KbPipelineService.RunTriggered(run.getId()));
        return get(run.getId());
    }

    public KbEvalDtos.Eval cancel(UUID id) {
        engine.inTx(() -> evals.findById(id).orElseThrow(() -> new ResourceNotFoundException("KbEval", id.toString())));
        engine.cancel(id);
        // Cascade: configurations and subjects not finished become CANCELLED.
        engine.inTxVoid(() -> {
            var eval = evals.findById(id).orElseThrow();
            var results = (ObjectNode) eval.getResults().deepCopy();
            results.with("configs").fields().forEachRemaining(c -> {
                var cfg = (ObjectNode) c.getValue();
                if (!List.of("SUCCEEDED", "FAILED").contains(cfg.path("status").asText())) cfg.put("status", "CANCELLED");
                cfg.with("subjects").fields().forEachRemaining(s -> {
                    var subj = (ObjectNode) s.getValue();
                    if (!subj.has("metrics")) subj.put("status", "CANCELLED");
                });
            });
            eval.setResults(results);
            eval.finish(OffsetDateTime.now(clock));
        });
        return get(id);
    }

    // POST /pipeline/compare: an eval over an ad-hoc set with one subject.
    public KbEvalDtos.Eval compare(String subjectId, JsonNode modelsBody, UUID userId) {
        configs(modelsBody);   // validate first
        var name = "compare " + subjectId + " " + OffsetDateTime.now(clock).toString();
        var set = createSet(name, List.of(subjectId), userId);
        return create(set.id(), modelsBody, "compare", userId);
    }

    public List<KbEvalDtos.Eval> list(UUID setId, int limit) {
        return engine.inTx(() -> {
            var list = setId == null
                ? evals.findAllByOrderByCreatedAtDesc(PageRequest.of(0, Math.max(1, Math.min(limit, 100))))
                : evals.findBySetIdOrderByCreatedAtAsc(setId).reversed();
            return list.stream().limit(Math.max(1, Math.min(limit, 100))).map(e -> view(e, false)).toList();
        });
    }

    public KbEvalDtos.Eval get(UUID id) {
        return get(id, null);
    }

    public KbEvalDtos.Eval get(UUID id, UUID viewer) {
        return engine.inTx(() -> view(evals.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("KbEval", id.toString())), true, viewer));
    }

    private KbEvalDtos.Eval view(KbEval e, boolean full) {
        return view(e, full, null);
    }

    private KbEvalDtos.Eval view(KbEval e, boolean full, UUID viewer) {
        var run = runs.findById(e.getId()).orElseThrow();
        var set = sets.findById(e.getSetId()).orElse(null);
        var results = e.getResults();
        var subjectNames = set == null ? Map.<String, String>of() : names(texts(set.getSubjectIds()));
        var rows = full ? progress.rows(e.getId()) : List.<org.ceitba.api.service.kb.progress.KbProgressMath.Row>of();
        var runState = full ? progress.state(run) : null;
        int subjectsWithInputs = 0;
        if (set != null && set.getFrozenInputs() != null) {
            for (var sid : set.getSubjectIds()) if (!set.getFrozenInputs().path(sid.asText()).isEmpty()) subjectsWithInputs++;
        }
        var configs = new ArrayList<KbEvalDtos.Config>();
        for (var c : configsOf(e)) {
            var r = results.path("configs").path(c.key());
            var perSubject = new ArrayList<KbEvalDtos.SubjectResult>();
            KbEvalDtos.ConfigProgress cfgProgress = null;
            if (full) {
                r.path("subjects").fields().forEachRemaining(s -> {
                    var pageList = new ArrayList<KbEvalDtos.PageResult>();
                    int written = 0;
                    int valid = 0;
                    var it = s.getValue().path("pages").fields();
                    while (it.hasNext()) {
                        var p = it.next();
                        var v = p.getValue();
                        var errs = new ArrayList<String>();
                        v.path("errors").forEach(x -> errs.add(x.asText()));
                        pageList.add(new KbEvalDtos.PageResult(p.getKey(), v.path("title").asText(null),
                            v.path("valid").asBoolean(false), v.path("firstPassValid").asBoolean(false), errs));
                        boolean isWritten = v.hasNonNull("key") || v.hasNonNull("first") || v.hasNonNull("final");
                        if (isWritten) written++;
                        boolean isValid = v.has("valid") ? v.path("valid").asBoolean(false)
                            : isWritten && (v.has("finalErrors") ? v.path("finalErrors").isEmpty() : v.path("firstErrors").isEmpty());
                        if (isValid) valid++;
                    }
                    // While WRITE runs, pages are only in the request rows.
                    var cfgPrefix = target(c.key(), null) + "#";
                    int answered = (int) rows.stream().filter(x -> x.stage().equals("WRITE") && x.status().equals("DONE")
                        && x.subjectId().equals(s.getKey()) && x.target().startsWith(cfgPrefix)).count();
                    perSubject.add(new KbEvalDtos.SubjectResult(s.getKey(), subjectNames.get(s.getKey()),
                        subjectStatus(run, s.getValue()), s.getValue().path("operations").size(), Math.max(written, answered),
                        valid,
                        s.getValue().path("metrics"), pageList));
                });
                var prefix = target(c.key(), null);
                var mine = rows.stream().filter(x -> !x.stage().equals("DIGEST")
                    && (x.target().equals(prefix) || x.target().startsWith(prefix + "#"))).toList();
                var o = org.ceitba.api.service.kb.progress.KbProgressMath.subset(mine, runState, subjectsWithInputs);
                cfgProgress = new KbEvalDtos.ConfigProgress(o.done(), o.total(), o.percent(), run.getStage());
            }
            var status = r.path("status").asText(run.isActive() ? "RUNNING" : run.getStatus());
            if (!run.isActive() && status.equals("RUNNING")) status = run.getStatus();   // ended mid-way
            configs.add(new KbEvalDtos.Config(c.key(), c.plan(), c.write(), c.effortNode(json), status,
                r.has("metrics") ? r.get("metrics") : null, perSubject, cfgProgress));
        }
        Long duration = e.getFinishedAt() == null ? null : Duration.between(e.getCreatedAt(), e.getFinishedAt()).toSeconds();
        var runProgress = full ? progress.progress(e.getId()) : null;
        var review = full && run.getStatus().equals("SUCCEEDED") ? reviewProgress(e, viewer) : null;
        return new KbEvalDtos.Eval(e.getId(), e.getSetId(), set == null ? null : set.getName(), run.getStatus(),
            run.getStage(), e.getNote(), e.getCreatedAt(), e.getFinishedAt(), duration, run.getTokensIn(),
            run.getTokensOut(), usd(run.getCostEstimate()), run.isSimulated(), run.getError(),
            results.path("sharedDigest").isMissingNode() ? null : results.get("sharedDigest"), configs, runProgress,
            review);
    }

    // pending | planning | writing | validating | done | failed | cancelled
    static String subjectStatus(KbRun run, JsonNode subj) {
        if (subj.path("status").asText("").equals("CANCELLED")) return "cancelled";
        if (subj.hasNonNull("error")) return "failed";
        if (subj.has("metrics")) return "done";
        switch (run.getStatus()) {
            case "CANCELLED" -> { return "cancelled"; }
            case "FAILED" -> { return "failed"; }
            case "SUCCEEDED" -> { return "done"; }
            default -> { }
        }
        return switch (run.getStage()) {
            case "DETECT", "DIGEST" -> "pending";
            case "PLAN" -> "planning";
            case "WRITE", "RETRY" -> subj.has("operations") && subj.path("operations").isEmpty() ? "done" : "writing";
            case "REPORT" -> "validating";
            default -> "pending";
        };
    }

    public org.ceitba.api.web.kb.dto.KbProgressResponse progress(UUID id) {
        engine.inTx(() -> evals.findById(id).orElseThrow(() -> new ResourceNotFoundException("KbEval", id.toString())));
        return progress.progress(id);
    }

    public KbEvalDtos.ReviewProgress reviewProgress(UUID evalId, UUID viewer) {
        return engine.inTx(() -> reviewProgress(evals.findById(evalId)
            .orElseThrow(() -> new ResourceNotFoundException("KbEval", evalId.toString())), viewer));
    }

    private KbEvalDtos.ReviewProgress reviewProgress(KbEval eval, UUID viewer) {
        var pairs = pairs(eval);
        var rated = ratings.findByEvalId(eval.getId()).stream().filter(KbEvalRating::isRated).toList();
        var byAnyone = new HashSet<String>();
        var byMe = new HashSet<String>();
        Map<String, Integer> perConfig = new LinkedHashMap<>();
        configsOf(eval).forEach(c -> perConfig.put(c.key(), 0));
        for (var r : rated) {
            var k = pairKey(r.getSubjectId(), r.getSlug(), r.getConfigA(), r.getConfigB());
            byAnyone.add(k);
            if (r.getReviewerId().equals(viewer)) byMe.add(k);
            perConfig.merge(r.getConfigA(), 1, Integer::sum);
            perConfig.merge(r.getConfigB(), 1, Integer::sum);
        }
        Map<String, int[]> perSubject = new java.util.TreeMap<>();
        for (var p : pairs) {
            var k = pairKey(p.subjectId(), p.slug(), p.c1(), p.c2());
            var a = perSubject.computeIfAbsent(p.subjectId(), x -> new int[3]);
            a[0]++;
            if (byMe.contains(k)) a[1]++;
            if (byAnyone.contains(k)) a[2]++;
        }
        var names = names(new ArrayList<>(perSubject.keySet()));
        var subjects = perSubject.entrySet().stream().map(x -> new KbEvalDtos.SubjectReview(x.getKey(),
            names.get(x.getKey()), x.getValue()[0], x.getValue()[1], x.getValue()[2])).toList();
        var byKey = new HashMap<String, Config>();
        configsOf(eval).forEach(c -> byKey.put(c.key(), c));
        var cfgs = perConfig.entrySet().stream().map(x -> {
            var c = byKey.get(x.getKey());
            return new KbEvalDtos.ConfigRatings(x.getKey(), c == null ? null : c.plan(), c == null ? null : c.write(),
                x.getValue());
        }).toList();
        int mine = (int) pairs.stream().filter(p -> byMe.contains(pairKey(p.subjectId(), p.slug(), p.c1(), p.c2()))).count();
        int anyone = (int) pairs.stream().filter(p -> byAnyone.contains(pairKey(p.subjectId(), p.slug(), p.c1(), p.c2())))
            .count();
        boolean confident = !cfgs.isEmpty() && cfgs.stream().allMatch(c -> c.ratings() >= SMALL_SAMPLE);
        return new KbEvalDtos.ReviewProgress(pairs.size(), mine, anyone, pairs.size() - mine, subjects, cfgs,
            SMALL_SAMPLE, confident);
    }

    // Rough input/output tokens and cost of an eval (missing digests, PLAN
    // and WRITE per config x subject, one retry for 15% of the pages).
    public KbEvalDtos.Estimate estimate(UUID setId, JsonNode modelsBody) {
        var configs = configs(modelsBody);
        return engine.inTx(() -> {
            var set = sets.findById(setId).orElseThrow(() -> new ResourceNotFoundException("KbEvalSet", setId.toString()));
            var s = settings.effective();
            var frozen = set.getFrozenInputs() != null ? set.getFrozenInputs() : frozenFromCurrent(set);
            long in = 0;
            long out = 0;
            var cost = BigDecimal.ZERO;
            var fps = new HashSet<String>();
            frozen.fields().forEachRemaining(f -> f.getValue().forEach(x -> fps.add(x.path("fingerprint").asText())));
            var known = new HashSet<String>();
            if (!fps.isEmpty()) {
                digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
                    .forEach(d -> known.add(d.getContentFingerprint()));
            }
            var catalog = catalog();
            var seen = new HashSet<String>();
            var it = frozen.fields();
            while (it.hasNext()) {
                var subject = it.next();
                int fileCount = subject.getValue().size();
                long chars = 0;
                for (var f : subject.getValue()) {
                    chars += f.path("chars").asLong();
                    var fp = f.path("fingerprint").asText();
                    if (known.contains(fp) || !seen.add(fp)) continue;
                    long di = (long) (f.path("chars").asLong() / 3.5) + 1500;
                    long dout = 600;
                    in += di;
                    out += dout;
                    cost = cost.add(price(catalog, s.modelDigest(), s.executionMode(), di, dout));
                }
                int pagesGuess = fileCount + 1;
                for (var c : configs) {
                    long pi = 3000 + 800L * fileCount;
                    long po = 1500;
                    long wi = (3000 + 100L * pagesGuess + Math.min(12_000, (long) (chars / 3.5 / pagesGuess)) + 2400)
                        * pagesGuess;
                    long wo = 2500L * pagesGuess;
                    long retries = (long) Math.ceil(pagesGuess * 0.15);
                    long ri = (3000 + 4000) * retries;
                    long ro = 2500 * retries;
                    in += pi + wi + ri;
                    out += po + wo + ro;
                    cost = cost.add(price(catalog, c.plan(), s.executionMode(), pi, po))
                        .add(price(catalog, c.write(), s.executionMode(), wi + ri, wo + ro));
                }
            }
            return new KbEvalDtos.Estimate(in, out, usd(cost));
        });
    }

    private BigDecimal price(Map<String, KbModel> catalog, String model, String mode, long in, long out) {
        return KbPricing.cost(catalog.get(model), router.modeFor(model, mode), in, 0, out);
    }

    private JsonNode frozenFromCurrent(KbEvalSet set) {
        var current = inputs.current();
        var o = json.createObjectNode();
        for (var sid : set.getSubjectIds()) {
            var arr = o.putArray(sid.asText());
            for (var i : current.getOrDefault(sid.asText(), List.of())) {
                arr.addObject().put("fingerprint", fingerprintOf(i.fileId(), i.fingerprint())).put("chars", i.chars());
            }
        }
        return o;
    }

    // ==== KbRunHandler ===============================================================

    @Override
    public boolean handles(KbRun run) {
        return run.isEval();
    }

    @Override
    public String usageStage(String stage) {
        return "EVAL";
    }

    @Override
    public boolean costLimited() {
        return false;
    }

    @Override
    public void detect(KbRun run) {
        var eval = evals.findById(run.getId()).orElseThrow();
        var set = sets.findById(eval.getSetId()).orElseThrow();
        boolean missing = !missingDigestFiles(set.getFrozenInputs()).isEmpty();
        var results = (ObjectNode) eval.getResults().deepCopy();
        var cfgs = results.with("configs");
        for (var c : configsOf(eval)) {
            var r = cfgs.putObject(c.key());
            r.put("status", "RUNNING");
            var subj = r.putObject("subjects");
            set.getSubjectIds().forEach(s -> subj.putObject(s.asText()).putObject("pages"));
        }
        eval.setResults(results);
        run.setStage(missing ? "DIGEST" : "PLAN");
    }

    @Override
    public int build(KbRun run, String stage, KbRunEngine.Seq seq) {
        var eval = evals.findById(run.getId()).orElseThrow();
        var set = sets.findById(eval.getSetId()).orElseThrow();
        var s = settings.effective();
        var frozen = set.getFrozenInputs();
        var out = new ArrayList<KbRunRequest>();
        switch (stage) {
            case "DIGEST" -> {
                for (var f : missingDigestFiles(frozen)) {
                    var text = text(f.path("textKey").asText());
                    var chunks = KbPayloads.chunks(text);
                    for (int i = 0; i < chunks.size(); i++) {
                        var t = "Archivo: " + f.path("name").asText() + " (parte " + (i + 1) + "/" + chunks.size()
                            + ")\n\n" + chunks.get(i);
                        out.add(engine.request(run, f.path("subjectId").asText(), "DIGEST", f.path("fileId").asText(),
                            i, s.modelDigest(), payloads.tuned(s.modelDigest(), "DIGEST", s, null, t), seq));
                    }
                }
            }
            case "PLAN" -> {
                for (var c : configsOf(eval)) {
                    for (var sid : set.getSubjectIds()) {
                        var subjectId = sid.asText();
                        var list = frozen.path(subjectId);
                        if (list.isEmpty()) continue;
                        var stable = json.createObjectNode();
                        stable.putObject("subject").put("id", subjectId).put("name", subjectName(subjectId));
                        stable.put("hasIndex", false);
                        stable.putArray("pages");
                        relatedInto(stable.putArray("related"), subjectId);
                        var body = json.createObjectNode();
                        var arr = body.putArray("addedOrChanged");
                        var byFp = digestsByFingerprint(list);
                        for (var f : list) {
                            var o = arr.addObject();
                            o.put("fileId", f.path("fileId").asText());
                            o.put("name", f.path("name").asText());
                            o.set("academicYear", f.path("academicYear"));
                            var d = byFp.get(f.path("fingerprint").asText());
                            o.set("digest", d == null ? null : d.getDigest());
                        }
                        body.putArray("removed");
                        var params = payloads.tuned(c.plan(), "PLAN", s.maxTokens("plan"), c.planEffort(),
                            payloads.toJson(stable), payloads.toJson(body));
                        out.add(engine.request(run, subjectId, "PLAN", target(c.key(), null), 0, c.plan(), params, seq));
                    }
                }
            }
            case "WRITE" -> {
                var results = eval.getResults();
                for (var c : configsOf(eval)) {
                    for (var sid : set.getSubjectIds()) {
                        var subjectId = sid.asText();
                        var r = results.path("configs").path(c.key()).path("subjects").path(subjectId);
                        var ops = r.path("operations");
                        if (ops.isEmpty()) continue;
                        var list = frozen.path(subjectId);
                        Map<String, JsonNode> byId = new HashMap<>();
                        list.forEach(f -> byId.put(f.path("fileId").asText(), f));
                        var byFp = digestsByFingerprint(list);
                        var stable = json.createObjectNode();
                        stable.putObject("subject").put("id", subjectId).put("name", subjectName(subjectId));
                        var index = stable.putArray("pages");
                        for (var op : ops) {
                            index.addObject().put("slug", op.path("slug").asText()).put("title", op.path("title").asText())
                                .putArray("aliases");
                        }
                        for (var op : ops) {
                            var body = json.createObjectNode();
                            body.put("slug", op.path("slug").asText());
                            body.put("type", op.path("type").asText());
                            body.put("title", op.path("title").asText());
                            body.put("reason", op.path("reason").asText(""));
                            var changed = body.putArray("changedSources");
                            body.putArray("keptSources");
                            var texts = new ArrayList<KbPayloads.SourceText>();
                            var keywords = new LinkedHashSet<String>();
                            keywords.add(op.path("title").asText());
                            for (var src : op.path("sources")) {
                                var f = byId.get(src.asText());
                                if (f == null) continue;
                                var o = changed.addObject();
                                o.put("fileId", src.asText());
                                o.put("name", f.path("name").asText());
                                o.set("academicYear", f.path("academicYear"));
                                var d = byFp.get(f.path("fingerprint").asText());
                                o.set("digest", d == null ? null : d.getDigest());
                                if (d != null) d.getDigest().path("topics").forEach(t -> keywords.add(t.path("name").asText()));
                                texts.add(new KbPayloads.SourceText(src.asText(), f.path("name").asText(),
                                    text(f.path("textKey").asText())));
                            }
                            var ex = body.putArray("excerpts");
                            for (var e : KbPayloads.excerpts(texts, keywords)) {
                                ex.addObject().put("fileId", e.fileId()).put("name", e.name()).put("text", e.text());
                            }
                            body.putArray("removedSources");
                            body.putNull("currentPage");
                            var params = payloads.tuned(c.write(), "WRITE", s.maxTokens("write"), c.writeEffort(),
                                payloads.toJson(stable), payloads.toJson(body));
                            out.add(engine.request(run, subjectId, "WRITE", target(c.key(), op.path("slug").asText()), 0,
                                c.write(), params, seq));
                        }
                    }
                }
            }
            case "RETRY" -> {
                var results = eval.getResults();
                for (var c : configsOf(eval)) {
                    for (var sid : set.getSubjectIds()) {
                        var subjectId = sid.asText();
                        var r = results.path("configs").path(c.key()).path("subjects").path(subjectId);
                        var allowed = json.createArrayNode();
                        frozen.path(subjectId).forEach(f -> allowed.addObject().put("fileId", f.path("fileId").asText())
                            .put("name", f.path("name").asText()));
                        var stable = json.createObjectNode();
                        stable.putObject("subject").put("id", subjectId).put("name", subjectName(subjectId));
                        var index = stable.putArray("pages");
                        r.path("operations").forEach(op -> index.addObject().put("slug", op.path("slug").asText())
                            .put("title", op.path("title").asText()));
                        r.path("pages").fields().forEachRemaining(p -> {
                            var page = p.getValue();
                            if (!page.hasNonNull("first") || page.path("firstErrors").isEmpty()) return;
                            var body = json.createObjectNode();
                            body.put("slug", p.getKey());
                            body.set("errors", page.path("firstErrors"));
                            body.put("page", page.path("first").asText());
                            body.set("allowedSources", allowed);
                            var params = payloads.tuned(c.write(), "RETRY", s.maxTokens("retry"), c.writeEffort(),
                                payloads.toJson(stable), payloads.toJson(body));
                            out.add(engine.request(run, subjectId, "RETRY", target(c.key(), p.getKey()), 0, c.write(),
                                params, seq));
                        });
                    }
                }
            }
            default -> { }
        }
        requests.saveAll(out);
        return out.size();
    }

    @Override
    public void after(KbRun run, String stage) {
        var eval = evals.findById(run.getId()).orElseThrow();
        var set = sets.findById(eval.getSetId()).orElseThrow();
        var rows = requests.findByRunIdAndStage(run.getId(), stage);
        var results = (ObjectNode) eval.getResults().deepCopy();
        var today = LocalDate.now(clock.withZone(ClockConfig.ZONE));
        switch (stage) {
            case "DIGEST" -> {
                Map<String, List<KbRunRequest>> byFile = new LinkedHashMap<>();
                rows.forEach(r -> byFile.computeIfAbsent(r.getTarget(), k -> new ArrayList<>()).add(r));
                var fpByFile = new HashMap<String, String>();
                set.getFrozenInputs().fields().forEachRemaining(e -> e.getValue()
                    .forEach(f -> fpByFile.put(f.path("fileId").asText(), f.path("fingerprint").asText())));
                for (var e : byFile.entrySet()) {
                    var chunks = e.getValue().stream().sorted(Comparator.comparingInt(KbRunRequest::getChunk)).toList();
                    if (chunks.stream().anyMatch(c -> !c.getStatus().equals("DONE"))) continue;
                    var fp = fpByFile.get(e.getKey());
                    if (fp == null || !digests.findByContentFingerprintInAndPromptVersion(List.of(fp),
                        KbPayloads.PROMPT_VERSION).isEmpty()) continue;
                    var fileId = UUID.fromString(e.getKey());
                    digests.save(new KbFileDigest(files.existsById(fileId) ? fileId : null, fp,
                        KbPayloads.PROMPT_VERSION, chunks.get(0).getModel(),
                        KbDigests.merge(chunks.stream().map(KbRunRequest::getResult).toList(), json),
                        chunks.stream().mapToInt(KbRunRequest::getTokensIn).sum(),
                        chunks.stream().mapToInt(KbRunRequest::getTokensOut).sum()));
                }
                run.setStage("PLAN");
            }
            case "PLAN" -> {
                for (var r : rows) {
                    var key = configOfTarget(r.getTarget());
                    var subj = results.with("configs").with(key).with("subjects").with(r.getSubjectId());
                    if (!r.getStatus().equals("DONE")) {
                        subj.put("error", "PLAN: " + r.getError());
                        subj.putArray("operations");
                        continue;
                    }
                    subj.set("operations", validateOps(r.getResult().path("operations"),
                        set.getFrozenInputs().path(r.getSubjectId())));
                }
                run.setStage("WRITE");
            }
            case "WRITE", "RETRY" -> {
                for (var r : rows) {
                    var key = configOfTarget(r.getTarget());
                    var slug = slugOfTarget(r.getTarget());
                    var subj = results.with("configs").with(key).with("subjects").with(r.getSubjectId());
                    var page = subj.with("pages").with(slug);
                    if (stage.equals("RETRY")) page.put("retried", true);
                    if (!r.getStatus().equals("DONE")) {
                        if (stage.equals("WRITE")) {
                            page.putNull("first");
                            page.putArray("firstErrors").add("no answer from the model: " + r.getError());
                        }
                        continue;
                    }
                    var op = opOf(subj.path("operations"), slug);
                    var markdown = r.getResult().isTextual() ? r.getResult().asText() : r.getResult().path("markdown").asText("");
                    var type = op == null ? KbPageType.CONCEPT
                        : KbPageType.valueOf(op.path("type").asText("concept").toUpperCase(Locale.ROOT));
                    var content = KbPageFiles.normalize(markdown, r.getSubjectId(), type,
                        op == null ? slug : op.path("title").asText(slug), "do:" + r.getModel(), today);
                    page.put(stage.equals("WRITE") ? "first" : "final", content);
                }
                // Validate per config x subject: first pass after WRITE, final after RETRY.
                for (var c : configsOf(eval)) {
                    var subjectsNode = results.with("configs").with(c.key()).with("subjects");
                    subjectsNode.fields().forEachRemaining(s -> validateSubject(s.getKey(), (ObjectNode) s.getValue(),
                        set.getFrozenInputs().path(s.getKey()), stage.equals("WRITE")));
                }
                run.setStage(stage.equals("WRITE") ? "RETRY" : "REPORT");
            }
            default -> { }
        }
        eval.setResults(results);
    }

    // REPORT: metrics, pages to storage, done.
    @Override
    public void complete(UUID runId) {
        engine.inTxVoid(() -> {
            var run = runs.findById(runId).orElseThrow();
            var eval = evals.findById(runId).orElseThrow();
            var set = sets.findById(eval.getSetId()).orElseThrow();
            var results = (ObjectNode) eval.getResults().deepCopy();
            var allRows = new ArrayList<KbRunRequest>();
            for (var st : List.of("DIGEST", "PLAN", "WRITE", "RETRY")) allRows.addAll(requests.findByRunIdAndStage(runId, st));
            Map<String, BigDecimal> costByRequest = new HashMap<>();
            for (var u : usage.findByEvalId(runId)) {
                if (u.getRequestIdOrNull() != null) costByRequest.merge(u.getRequestIdOrNull(), u.getCostUsd(), BigDecimal::add);
            }
            var textCache = new HashMap<String, String>();
            var digestsByFp = new HashMap<String, KbFileDigest>();
            Long duration = Duration.between(eval.getCreatedAt(), OffsetDateTime.now(clock)).toSeconds();

            // Digests computed for the set (shared by every configuration).
            var digestRows = allRows.stream().filter(r -> r.getStage().equals("DIGEST")).toList();
            var shared = results.putObject("sharedDigest");
            shared.put("requests", digestRows.size());
            shared.put("inputTokens", digestRows.stream().mapToLong(KbRunRequest::getTokensIn).sum());
            shared.put("outputTokens", digestRows.stream().mapToLong(KbRunRequest::getTokensOut).sum());
            shared.put("costUsd", usd(digestRows.stream().map(r -> costByRequest.getOrDefault(r.getCustomId(), BigDecimal.ZERO))
                .reduce(BigDecimal.ZERO, BigDecimal::add)));

            for (var c : configsOf(eval)) {
                var cfg = results.with("configs").with(c.key());
                var allPages = new ArrayList<KbEvalMetrics.PageInput>();
                int allPlanned = 0;
                var cfgRows = allRows.stream().filter(r -> !r.getStage().equals("DIGEST") && configOfTarget(r.getTarget()).equals(c.key())).toList();
                var cfgUsage = usageOf(cfgRows, costByRequest);
                boolean anyOk = false;
                var it = cfg.with("subjects").fields();
                while (it.hasNext()) {
                    var s = it.next();
                    var subjectId = s.getKey();
                    var subj = (ObjectNode) s.getValue();
                    var frozenFiles = set.getFrozenInputs().path(subjectId);
                    var pageInputs = new ArrayList<KbEvalMetrics.PageInput>();
                    var summary = json.createObjectNode();
                    subj.path("pages").fields().forEachRemaining(p -> {
                        var page = p.getValue();
                        var first = page.hasNonNull("first") ? page.path("first").asText() : null;
                        var fin = page.hasNonNull("final") ? page.path("final").asText() : first;
                        var firstErrors = list(page.path("firstErrors"));
                        var finalErrors = page.has("finalErrors") ? list(page.path("finalErrors")) : firstErrors;
                        var sourceText = sourceText(fin, frozenFiles, textCache, digestsByFp);
                        pageInputs.add(new KbEvalMetrics.PageInput(p.getKey(), first, firstErrors,
                            page.path("coverage").asInt(0), fin, finalErrors, sourceText));
                        var o = summary.putObject(p.getKey());
                        var fm = fin == null ? null : KbPageFiles.split(fin).frontmatter();
                        o.put("title", fm == null ? p.getKey() : String.valueOf(fm.get("title")));
                        o.put("valid", fin != null && finalErrors.isEmpty());
                        o.put("firstPassValid", first != null && firstErrors.isEmpty());
                        var errs = o.putArray("errors");
                        finalErrors.forEach(errs::add);
                        if (fin != null) {
                            var key = pageKey(runId, c.key(), subjectId, p.getKey());
                            var bytes = fin.getBytes(StandardCharsets.UTF_8);
                            storage.put(key, "text/markdown; charset=utf-8", new ByteArrayInputStream(bytes), bytes.length);
                            o.put("key", key);
                        }
                    });
                    int planned = subj.path("operations").size();
                    allPlanned += planned;
                    allPages.addAll(pageInputs);
                    var subjRows = cfgRows.stream().filter(r -> r.getSubjectId().equals(subjectId)).toList();
                    subj.set("metrics", KbEvalMetrics.compute(pageInputs, planned, usageOf(subjRows, costByRequest),
                        duration, json));
                    subj.set("pages", summary);
                    if (!pageInputs.isEmpty()) anyOk = true;
                }
                cfg.set("metrics", KbEvalMetrics.compute(allPages, allPlanned, cfgUsage, duration, json));
                cfg.put("status", anyOk ? "SUCCEEDED" : "FAILED");
            }
            eval.setResults(results);
            eval.finish(OffsetDateTime.now(clock));
            run.setStage("DONE");
            run.finish("SUCCEEDED", OffsetDateTime.now(clock));
            log.info("KB eval {} done", runId);
        });
    }

    private KbEvalMetrics.Usage usageOf(List<KbRunRequest> rows, Map<String, BigDecimal> costByRequest) {
        long in = 0;
        long out = 0;
        var cost = BigDecimal.ZERO;
        int empty = 0;
        for (var r : rows) {
            in += r.getTokensIn();
            out += r.getTokensOut();
            cost = cost.add(costByRequest.getOrDefault(r.getCustomId(), BigDecimal.ZERO));
            var err = r.getError();
            if ((err != null && (err.startsWith("EMPTY_TOOL") || err.startsWith("TRUNCATED")))
                    || (r.getExecPath() != null && r.getExecPath().endsWith("+retry"))) empty++;
        }
        return new KbEvalMetrics.Usage(in, out, cost, rows.size(), empty);
    }

    // ---- eval validation (against the frozen inputs, never the live DB) -------------

    // Links and validates the subject's pages of one configuration; stores
    // first-pass (or final) errors, and the unlinked mentions before linking.
    private void validateSubject(String subjectId, ObjectNode subj, JsonNode frozenFiles, boolean firstPass) {
        var pagesNode = subj.with("pages");
        Map<String, String> contents = new LinkedHashMap<>();
        pagesNode.fields().forEachRemaining(p -> {
            var v = p.getValue();
            var content = firstPass ? v.path("first") : (v.hasNonNull("final") ? v.path("final") : v.path("first"));
            if (content.isTextual()) contents.put(p.getKey(), content.asText());
        });
        Map<UUID, KbValidator.SourceInfo> sources = new HashMap<>();
        for (var f : frozenFiles) {
            var id = UUID.fromString(f.path("fileId").asText());
            sources.put(id, new KbValidator.SourceInfo(id, true, subjectId, text(f.path("textKey").asText())));
        }
        // Targets of the coverage rule: the pages of this configuration.
        var targets = new ArrayList<KbLinker.Target>();
        for (var e : contents.entrySet()) {
            var fm = KbPageFiles.split(e.getValue()).frontmatter();
            var aliases = new ArrayList<String>();
            if (fm != null && fm.get("aliases") instanceof java.util.Collection<?> c) c.forEach(a -> aliases.add(String.valueOf(a)));
            targets.add(new KbLinker.Target(e.getKey(), fm == null ? e.getKey() : String.valueOf(fm.get("title")), aliases));
        }
        Map<String, String> linked = new LinkedHashMap<>();
        for (var e : contents.entrySet()) {
            var body = KbPageFiles.split(e.getValue()).body();
            if (firstPass) pagesNode.with(e.getKey()).put("coverage", KbLinker.unlinked(body, e.getKey(), targets).size());
            linked.put(e.getKey(), KbPageFiles.replaceBody(e.getValue(), KbLinker.link(body, e.getKey(), targets).body()));
        }
        Map<String, Set<String>> anchors = new HashMap<>();
        Map<String, KbPageParser.Draft> drafts = new LinkedHashMap<>();
        Map<String, List<String>> errors = new LinkedHashMap<>();
        for (var e : linked.entrySet()) {
            var parsed = KbPageParser.parse(e.getKey() + ".md", e.getValue(), subjectId);
            if (!parsed.ok()) {
                errors.put(e.getKey(), parsed.errors());
                continue;
            }
            drafts.put(e.getKey(), parsed.draft());
            anchors.put(e.getKey(), KbWikilinks.headingAnchors(parsed.draft().body()));
        }
        for (var d : drafts.values()) {
            var errs = new ArrayList<>(KbValidator.validate(d, sources));
            for (var l : d.links().links()) {
                if (l.anchor() == null || !l.subjectId().equals(subjectId) || !anchors.containsKey(l.slug())) continue;
                if (!anchors.get(l.slug()).contains(l.anchor())) {
                    errs.add("link [[" + l.raw() + "]]: no heading '#" + l.anchor() + "' in " + subjectId + "/" + l.slug());
                }
            }
            for (var m : KbLinker.unlinked(d.body(), d.slug(), targets)) {
                errs.add("unlinked mention of '" + m.text() + "': link it as [[" + m.slug() + "|" + m.text() + "]]");
            }
            errors.put(d.slug(), errs);
        }
        for (var e : linked.entrySet()) {
            var page = pagesNode.with(e.getKey());
            var arr = page.putArray(firstPass ? "firstErrors" : "finalErrors");
            errors.getOrDefault(e.getKey(), List.of()).forEach(arr::add);
            page.put(firstPass ? "first" : "final", e.getValue());
        }
    }

    // The plan made safe for a full rebuild: creates only, Spanish-style
    // slugs, sources limited to the frozen files, an index page.
    JsonNode validateOps(JsonNode proposed, JsonNode frozenFiles) {
        var valid = new HashSet<String>();
        frozenFiles.forEach(f -> valid.add(f.path("fileId").asText()));
        var out = json.createArrayNode();
        var seen = new HashSet<String>();
        for (var op : proposed) {
            var kind = op.path("op").asText("create").toLowerCase(Locale.ROOT);
            var slug = op.path("slug").asText("").trim();
            if (kind.equals("delete") || !KbWikilinks.SLUG.matcher(slug).matches() || slug.equals("graph")
                || !seen.add(slug)) continue;
            var type = slug.equals("index") ? "index" : op.path("type").asText("concept");
            if (!List.of("topic", "concept").contains(type) && !slug.equals("index")) type = "concept";
            var sources = json.createArrayNode();
            for (var s : op.path("sources")) if (valid.contains(s.asText())) sources.add(s.asText());
            if (sources.isEmpty()) continue;
            var o = out.addObject();
            o.put("op", "create");
            o.put("slug", slug);
            o.put("type", type);
            o.put("title", op.path("title").asText(slug.replace('-', ' ')));
            o.set("sources", sources);
            o.put("reason", op.path("reason").asText(""));
        }
        return out;
    }

    // ==== reading pages and blind review =============================================

    public KbEvalDtos.ReviewPage page(UUID evalId, String configKey, String subjectId, String slug) {
        return engine.inTx(() -> {
            var eval = evals.findById(evalId).orElseThrow(() -> new ResourceNotFoundException("KbEval", evalId.toString()));
            var key = eval.getResults().path("configs").path(configKey).path("subjects").path(subjectId)
                .path("pages").path(slug).path("key").asText(null);
            if (key == null) throw new ResourceNotFoundException("KbEval page", configKey + "/" + subjectId + "/" + slug);
            return reviewPage(eval, configKey, subjectId, key, sets.findById(eval.getSetId()).orElseThrow());
        });
    }

    record Pair(String subjectId, String slug, String c1, String c2) {}

    // The same page written by two configurations, in random A/B order,
    // model names hidden; null when this reviewer rated every pair.
    public KbEvalDtos.ReviewPair next(UUID evalId, UUID reviewerId, String subjectId, String slug) {
        return engine.inTx(() -> {
            var eval = evals.findById(evalId).orElseThrow(() -> new ResourceNotFoundException("KbEval", evalId.toString()));
            var set = sets.findById(eval.getSetId()).orElseThrow();
            var pairs = pairs(eval).stream()
                .filter(p -> subjectId == null || p.subjectId().equals(subjectId))
                .filter(p -> slug == null || p.slug().equals(slug))
                .toList();
            var mine = ratings.findByEvalId(evalId).stream().filter(r -> r.getReviewerId().equals(reviewerId)).toList();
            var rated = new HashSet<String>();
            KbEvalRating pending = null;
            for (var r : mine) {
                var k = pairKey(r.getSubjectId(), r.getSlug(), r.getConfigA(), r.getConfigB());
                if (r.isRated()) rated.add(k);
                else if (pending == null && (subjectId == null || r.getSubjectId().equals(subjectId))
                    && (slug == null || r.getSlug().equals(slug))) pending = r;
            }
            var open = pairs.stream().filter(p -> !rated.contains(pairKey(p.subjectId(), p.slug(), p.c1(), p.c2()))).toList();
            if (open.isEmpty()) return null;
            KbEvalRating assignment;
            if (pending != null && !rated.contains(pairKey(pending.getSubjectId(), pending.getSlug(), pending.getConfigA(),
                    pending.getConfigB()))) {
                assignment = pending;
            } else {
                var p = open.get(random.nextInt(open.size()));
                boolean swap = random.nextBoolean();
                assignment = ratings.save(new KbEvalRating(evalId, p.subjectId(), p.slug(), swap ? p.c2() : p.c1(),
                    swap ? p.c1() : p.c2(), reviewerId, OffsetDateTime.now(clock)));
            }
            var a = pageKeyOf(eval, assignment.getConfigA(), assignment.getSubjectId(), assignment.getSlug());
            var b = pageKeyOf(eval, assignment.getConfigB(), assignment.getSubjectId(), assignment.getSlug());
            int reviewed = pairs(eval).size() - open.size();
            var all = pairs(eval).size();
            return new KbEvalDtos.ReviewPair(assignment.getSubjectId(), assignment.getSlug(), open.size(),
                subjectId == null && slug == null ? reviewed : reviewProgress(eval, reviewerId).reviewedByMe(), all,
                reviewPage(eval, assignment.getConfigA(), assignment.getSubjectId(), a, set),
                reviewPage(eval, assignment.getConfigB(), assignment.getSubjectId(), b, set));
        });
    }

    // Rates the pending pair of this page; returns which configurations A and B were.
    public KbEvalDtos.ReviewResult review(UUID evalId, UUID reviewerId, JsonNode body) {
        var subjectId = body.path("subjectId").asText(null);
        var slug = body.path("slug").asText(null);
        var winner = body.path("winner").asText("");
        if (!List.of("A", "B", "tie").contains(winner)) throw new ValidationException("winner", winner, "must be A, B or tie");
        var a = scores(body.path("scoresA"), "scoresA");
        var b = scores(body.path("scoresB"), "scoresB");
        var comment = body.path("comment").isTextual() ? body.path("comment").asText() : null;
        return engine.inTx(() -> {
            var eval = evals.findById(evalId).orElseThrow(() -> new ResourceNotFoundException("KbEval", evalId.toString()));
            var pending = ratings.findByEvalIdAndReviewerIdAndSubjectIdAndSlugOrderByAssignedAtDesc(evalId, reviewerId,
                subjectId, slug).stream().filter(r -> !r.isRated()).findFirst()
                .orElseThrow(() -> new KbPipelineException(KbPipelineException.Reason.NO_PAIRS,
                    "No pending pair for this page; call review/next first"));
            var w = switch (winner) {
                case "A" -> pending.getConfigA();
                case "B" -> pending.getConfigB();
                default -> "tie";
            };
            pending.rate(w, a, b, comment, OffsetDateTime.now(clock));
            var byKey = new HashMap<String, Config>();
            configsOf(eval).forEach(c -> byKey.put(c.key(), c));
            return new KbEvalDtos.ReviewResult(new KbEvalDtos.Revealed(ref(byKey.get(pending.getConfigA()), pending.getConfigA()),
                ref(byKey.get(pending.getConfigB()), pending.getConfigB())));
        });
    }

    private static KbEvalDtos.ConfigRef ref(Config c, String key) {
        return c == null ? new KbEvalDtos.ConfigRef(key, null, null) : new KbEvalDtos.ConfigRef(c.key(), c.plan(), c.write());
    }

    private static Short[] scores(JsonNode n, String field) {
        if (n == null || n.isMissingNode() || n.isNull()) return null;
        var out = new Short[3];
        var names = List.of("accuracy", "clarity", "usefulness");
        for (int i = 0; i < 3; i++) {
            var v = n.path(names.get(i));
            if (v.isMissingNode() || v.isNull()) continue;
            if (!v.canConvertToInt() || v.asInt() < 1 || v.asInt() > 5) {
                throw new ValidationException(field + "." + names.get(i), v, "must be 1-5");
            }
            out[i] = (short) v.asInt();
        }
        return out;
    }

    // Pages (subject, slug) written by at least two configurations, as pairs.
    private List<Pair> pairs(KbEval eval) {
        var out = new ArrayList<Pair>();
        Map<String, List<String>> byPage = new java.util.TreeMap<>();
        eval.getResults().path("configs").fields().forEachRemaining(c -> c.getValue().path("subjects").fields()
            .forEachRemaining(s -> s.getValue().path("pages").fields().forEachRemaining(p -> {
                if (p.getValue().hasNonNull("key")) {
                    byPage.computeIfAbsent(s.getKey() + "\n" + p.getKey(), k -> new ArrayList<>()).add(c.getKey());
                }
            })));
        byPage.forEach((k, cs) -> {
            var parts = k.split("\n");
            for (int i = 0; i < cs.size(); i++) {
                for (int j = i + 1; j < cs.size(); j++) out.add(new Pair(parts[0], parts[1], cs.get(i), cs.get(j)));
            }
        });
        return out;
    }

    private static String pairKey(String subjectId, String slug, String c1, String c2) {
        var a = c1.compareTo(c2) <= 0 ? c1 : c2;
        var b = c1.compareTo(c2) <= 0 ? c2 : c1;
        return subjectId + "\n" + slug + "\n" + a + "\n" + b;
    }

    private String pageKeyOf(KbEval eval, String configKey, String subjectId, String slug) {
        return eval.getResults().path("configs").path(configKey).path("subjects").path(subjectId).path("pages")
            .path(slug).path("key").asText(null);
    }

    private KbEvalDtos.ReviewPage reviewPage(KbEval eval, String configKey, String subjectId, String key,
                                             KbEvalSet set) {
        var content = key == null ? "" : text(key);
        var parts = KbPageFiles.split(content);
        var fm = parts.frontmatter();
        // Sources: the reader's shape; files gone since the freeze keep their frozen name.
        var ids = new ArrayList<UUID>();
        if (fm != null && fm.get("sources") instanceof java.util.Collection<?> c) {
            for (var s : c) {
                try {
                    ids.add(UUID.fromString(String.valueOf(s)));
                } catch (IllegalArgumentException ignored) {
                    // not a file id
                }
            }
        }
        var found = new HashMap<UUID, org.ceitba.api.web.kb.dto.KbSourceResponse>();
        views.staffSources(ids).forEach(s -> found.put(s.id(), s));
        Map<String, JsonNode> frozen = new HashMap<>();
        set.getFrozenInputs().path(subjectId).forEach(f -> frozen.put(f.path("fileId").asText(), f));
        var sources = new ArrayList<org.ceitba.api.web.kb.dto.KbSourceResponse>();
        for (var id : ids) {
            var s = found.get(id);
            if (s == null) {
                var f = frozen.get(id.toString());
                s = new org.ceitba.api.web.kb.dto.KbSourceResponse(id, f == null ? null : f.path("name").asText(null),
                    null, null, f == null || !f.path("academicYear").canConvertToInt() ? null : f.path("academicYear").asInt(),
                    null);
            }
            sources.add(s);
        }
        // Links: resolved against the pages this configuration wrote for the
        // subject, else against live visible pages.
        var written = eval.getResults().path("configs").path(configKey).path("subjects").path(subjectId).path("pages");
        var links = new ArrayList<org.ceitba.api.web.kb.dto.KbLinkResponse>();
        for (var l : KbWikilinks.parse(parts.body(), subjectId).links()) {
            String title = null;
            if (l.subjectId().equals(subjectId) && written.path(l.slug()).hasNonNull("key")) {
                title = written.path(l.slug()).path("title").asText(l.slug());
            } else {
                var live = pages.findBySubjectIdAndSlug(l.subjectId(), l.slug()).orElse(null);
                if (KbViews.visible(live, true)) title = live.getTitle();
            }
            links.add(new org.ceitba.api.web.kb.dto.KbLinkResponse(l.raw(), l.subjectId(), l.slug(), l.anchor(),
                title != null, title));
        }
        return new KbEvalDtos.ReviewPage(fm == null ? null : String.valueOf(fm.get("title")), parts.body(), sources, links);
    }

    // ==== leaderboard and promote ======================================================

    public KbEvalDtos.Leaderboard leaderboard(UUID setId) {
        if (setId == null) ensureDefaultSet();
        return engine.inTx(() -> {
            var set = setId != null
                ? sets.findById(setId).orElseThrow(() -> new ResourceNotFoundException("KbEvalSet", setId.toString()))
                : sets.findByName(DEFAULT_SET).orElse(null);
            if (set == null) return new KbEvalDtos.Leaderboard(null, null, List.of());
            var done = evals.findBySetIdOrderByCreatedAtAsc(set.getId()).stream()
                .filter(e -> runs.findById(e.getId()).map(r -> r.getStatus().equals("SUCCEEDED")).orElse(false))
                .toList();
            Map<String, Config> configs = new LinkedHashMap<>();
            Map<String, List<JsonNode>> metrics = new HashMap<>();
            for (var e : done) {
                for (var c : configsOf(e)) {
                    configs.putIfAbsent(c.key(), c);
                    var m = e.getResults().path("configs").path(c.key()).path("metrics");
                    if (m.isObject()) metrics.computeIfAbsent(c.key(), k -> new ArrayList<>()).add(m);
                }
            }
            var all = ratings.findByEvalIdIn(done.stream().map(KbEval::getId).toList()).stream()
                .filter(KbEvalRating::isRated).toList();
            var entries = new ArrayList<KbEvalDtos.LeaderboardEntry>();
            for (var c : configs.values()) {
                int wins = 0;
                int losses = 0;
                int ties = 0;
                var acc = new double[3];
                var cnt = new int[3];
                for (var r : all) {
                    boolean isA = r.getConfigA().equals(c.key());
                    boolean isB = r.getConfigB().equals(c.key());
                    if (!isA && !isB) continue;
                    if (r.getWinner().equals("tie")) ties++;
                    else if (r.getWinner().equals(c.key())) wins++;
                    else losses++;
                    var sc = isA ? new Short[]{r.getAccuracyA(), r.getClarityA(), r.getUsefulnessA()}
                        : new Short[]{r.getAccuracyB(), r.getClarityB(), r.getUsefulnessB()};
                    for (int i = 0; i < 3; i++) {
                        if (sc[i] != null) {
                            acc[i] += sc[i];
                            cnt[i]++;
                        }
                    }
                }
                int n = wins + losses + ties;
                var combined = combine(metrics.getOrDefault(c.key(), List.of()));
                var cost = combined.path("costUsd").decimalValue();
                var valid = combined.path("validPages").asInt();
                entries.add(new KbEvalDtos.LeaderboardEntry(c.key(), c.plan(), c.write(), c.effortNode(json),
                    metrics.getOrDefault(c.key(), List.of()).size(), n, wins, losses, ties,
                    n == 0 ? null : Math.round((wins + ties / 2.0) / n * 10000) / 10000.0,
                    new KbEvalDtos.Scores(avg(acc[0], cnt[0]), avg(acc[1], cnt[1]), avg(acc[2], cnt[2])),
                    combined, usd(cost), valid == 0 ? null : cost.divide(BigDecimal.valueOf(valid), 4, RoundingMode.HALF_UP),
                    n < SMALL_SAMPLE));
            }
            entries.sort(Comparator.comparing((KbEvalDtos.LeaderboardEntry e) -> e.winRate() == null ? -1 : e.winRate())
                .reversed()
                .thenComparing(e -> e.costPerValidPage() == null ? BigDecimal.valueOf(Long.MAX_VALUE) : e.costPerValidPage()));
            return new KbEvalDtos.Leaderboard(set.getId(), set.getName(), entries);
        });
    }

    // Totals of several evals of one configuration (rates weighted by size).
    ObjectNode combine(List<JsonNode> list) {
        var out = json.createObjectNode();
        long[] sums = new long[12];
        var cost = BigDecimal.ZERO;
        double fp = 0;
        double fv = 0;
        double cd = 0;
        double unsup = 0;
        double words = 0;
        double empty = 0;
        Map<String, Integer> reasons = new java.util.TreeMap<>();
        for (var m : list) {
            long written = m.path("pagesWritten").asLong();
            long checked = m.path("claimsChecked").asLong();
            sums[0] += m.path("pagesPlanned").asLong();
            sums[1] += written;
            sums[2] += m.path("validPages").asLong();
            sums[3] += m.path("uncitedSections").asLong();
            sums[4] += m.path("coverageViolations").asLong();
            sums[5] += m.path("copyViolations").asLong();
            sums[6] += m.path("crossLinks").asLong();
            sums[7] += m.path("anchors").asLong();
            sums[8] += m.path("inputTokens").asLong();
            sums[9] += m.path("outputTokens").asLong();
            sums[10] += checked;
            sums[11] += m.path("durationSec").asLong();
            cost = cost.add(m.path("costUsd").decimalValue());
            fp += m.path("firstPassValidRate").asDouble() * written;
            fv += m.path("finalValidRate").asDouble() * written;
            cd += m.path("citationDensity").asDouble() * written;
            words += m.path("avgWords").asDouble() * written;
            unsup += m.path("unsupportedClaimsRate").asDouble() * checked;
            empty += m.path("emptyToolCallRate").asDouble();
            m.path("rejectReasons").fields().forEachRemaining(r -> reasons.merge(r.getKey(), r.getValue().asInt(), Integer::sum));
        }
        long written = sums[1];
        out.put("pagesPlanned", sums[0]);
        out.put("pagesWritten", written);
        out.put("validPages", sums[2]);
        out.put("firstPassValidRate", written == 0 ? 0 : round(fp / written));
        out.put("finalValidRate", written == 0 ? 0 : round(fv / written));
        var rr = out.putObject("rejectReasons");
        reasons.forEach(rr::put);
        out.put("citationDensity", written == 0 ? 0 : round(cd / written));
        out.put("uncitedSections", sums[3]);
        out.put("coverageViolations", sums[4]);
        out.put("copyViolations", sums[5]);
        out.put("unsupportedClaimsRate", sums[10] == 0 ? 0 : round(unsup / sums[10]));
        out.put("claimsChecked", sums[10]);
        out.put("groundingIsHeuristic", true);
        out.put("avgWords", written == 0 ? 0 : Math.round(words / written));
        out.put("crossLinks", sums[6]);
        out.put("anchors", sums[7]);
        out.put("inputTokens", sums[8]);
        out.put("outputTokens", sums[9]);
        out.put("costUsd", usd(cost));
        if (sums[2] == 0) out.putNull("costPerValidPage");
        else out.put("costPerValidPage", cost.divide(BigDecimal.valueOf(sums[2]), 4, RoundingMode.HALF_UP));
        out.put("emptyToolCallRate", list.isEmpty() ? 0 : round(empty / list.size()));
        out.put("durationSec", list.isEmpty() ? 0 : sums[11] / list.size());
        return out;
    }

    // Copies a configuration's models (and efforts) into the runtime settings,
    // with the same validation and history as PUT /settings.
    public KbSettingsResponse promote(UUID evalId, String configKey, UUID userId) {
        var eval = engine.inTx(() -> evals.findById(evalId).orElseThrow(() -> new ResourceNotFoundException("KbEval", evalId.toString())));
        var c = configsOf(eval).stream().filter(x -> x.key().equals(configKey)).findFirst()
            .orElseThrow(() -> new ValidationException("configKey", configKey, "not a configuration of this eval"));
        var body = json.createObjectNode();
        body.put("modelPlan", c.plan());
        body.put("modelWrite", c.write());
        body.put("modelRetry", c.write());
        if (c.planEffort() != null || c.writeEffort() != null) {
            var current = settings.effective().reasoningEffort();
            var e = body.putObject("reasoningEffort");
            e.set("digest", current.path("digest"));
            e.put("plan", c.planEffort());
            e.put("write", c.writeEffort());
            e.put("retry", c.writeEffort());
        }
        body.put("note", "promoted from eval " + evalId + " (" + configKey + ")");
        return settings.update(userId, body);
    }

    // ==== helpers ==========================================================================

    // Frozen files whose content has no digest yet (one entry per fingerprint).
    private List<ObjectNode> missingDigestFiles(JsonNode frozen) {
        var out = new ArrayList<ObjectNode>();
        if (frozen == null) return out;
        var fps = new HashSet<String>();
        frozen.fields().forEachRemaining(e -> e.getValue().forEach(f -> fps.add(f.path("fingerprint").asText())));
        var known = new HashSet<String>();
        if (!fps.isEmpty()) {
            digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
                .forEach(d -> known.add(d.getContentFingerprint()));
        }
        var seen = new HashSet<String>();
        frozen.fields().forEachRemaining(e -> e.getValue().forEach(f -> {
            var fp = f.path("fingerprint").asText();
            if (known.contains(fp) || !seen.add(fp)) return;
            var o = (ObjectNode) f.deepCopy();
            o.put("subjectId", e.getKey());
            out.add(o);
        }));
        return out;
    }

    private Map<String, KbFileDigest> digestsByFingerprint(JsonNode frozenFiles) {
        var fps = new HashSet<String>();
        frozenFiles.forEach(f -> fps.add(f.path("fingerprint").asText()));
        Map<String, KbFileDigest> out = new HashMap<>();
        if (fps.isEmpty()) return out;
        digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
            .forEach(d -> out.putIfAbsent(d.getContentFingerprint(), d));
        return out;
    }

    // Cited sources' frozen texts plus their digests (the grounding corpus).
    private String sourceText(String content, JsonNode frozenFiles, Map<String, String> cache,
                              Map<String, KbFileDigest> digestCache) {
        if (content == null) return "";
        var cited = new HashSet<>(KbPageFiles.citedIds(KbPageFiles.split(content).body()));
        var sb = new StringBuilder();
        for (var f : frozenFiles) {
            if (!cited.contains(f.path("fileId").asText())) continue;
            sb.append(cache.computeIfAbsent(f.path("textKey").asText(), this::text)).append('\n');
            var fp = f.path("fingerprint").asText();
            var d = digestCache.computeIfAbsent(fp, k -> digests.findByContentFingerprintInAndPromptVersion(List.of(k),
                KbPayloads.PROMPT_VERSION).stream().findFirst().orElse(null));
            if (d != null) sb.append(d.getDigest()).append('\n');
        }
        return sb.toString();
    }

    private void relatedInto(ArrayNode arr, String subjectId) {
        int n = 0;
        for (var rel : relations.findBySubject(subjectId)) {
            if (n >= 8) break;
            var relPages = pages.findBySubjectIdAndStatusIn(rel.relatedId(), List.of(KbPageStatus.PUBLISHED));
            if (relPages.isEmpty()) continue;
            n++;
            var o = arr.addObject();
            o.put("subjectId", rel.relatedId());
            o.put("name", subjectName(rel.relatedId()));
            var list = o.putArray("pages");
            relPages.stream().sorted(Comparator.comparing(p -> p.getSlug())).forEach(p -> {
                var e = list.addObject();
                e.put("slug", p.getSlug());
                e.put("title", p.getTitle());
                e.put("summary", p.getSummary());
            });
        }
    }

    private JsonNode opOf(JsonNode ops, String slug) {
        for (var op : ops) if (op.path("slug").asText().equals(slug)) return op;
        return null;
    }

    // Request targets: "<configKey>" (PLAN) or "<configKey>#<slug>" (WRITE,
    // RETRY); keys longer than 80 chars are hashed to fit the column.
    static String target(String configKey, String slug) {
        var key = configKey.length() <= 80 ? configKey : "h:" + sha(configKey);
        var t = slug == null ? key : key + "#" + slug;
        return t.length() <= 128 ? t : t.substring(0, 128);
    }

    private String configOfTarget(String target) {
        var key = target.contains("#") ? target.substring(0, target.indexOf('#')) : target;
        if (!key.startsWith("h:")) return key;
        for (var e : evals.findAll()) {
            for (var c : configsOf(e)) if (("h:" + sha(c.key())).equals(key)) return c.key();
        }
        return key;
    }

    private static String slugOfTarget(String target) {
        return target.substring(target.indexOf('#') + 1);
    }

    private static String sha(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)), 0, 12);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String pageKey(UUID evalId, String configKey, String subjectId, String slug) {
        return "kb/evals/" + evalId + "/" + configKey.replace("|", "__").replace("@", "_at_") + "/" + subjectId + "/"
            + slug + ".md";
    }

    private String text(String key) {
        var bytes = storage.get(key);
        return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
    }

    private String subjectName(String id) {
        return subjects.findById(id).map(Subject::getName).orElse(id);
    }

    private Map<String, String> names(List<String> ids) {
        Map<String, String> out = new HashMap<>();
        subjects.findAllById(ids).forEach(s -> out.put(s.getId(), s.getName()));
        return out;
    }

    private static List<String> texts(JsonNode arr) {
        var out = new ArrayList<String>();
        arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static List<String> list(JsonNode arr) {
        var out = new ArrayList<String>();
        if (arr != null) arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    private Map<String, KbModel> catalog() {
        Map<String, KbModel> out = new HashMap<>();
        models.findAll().forEach(m -> out.put(m.getId(), m));
        return out;
    }

    static String fingerprintOf(UUID fileId, String fingerprint) {
        return fingerprint != null ? fingerprint : "file:" + fileId;
    }

    private static Double avg(double sum, int n) {
        return n == 0 ? null : Math.round(sum / n * 100) / 100.0;
    }

    private static double round(double v) {
        return Math.round(v * 10000) / 10000.0;
    }

    private static BigDecimal usd(BigDecimal v) {
        return (v == null ? BigDecimal.ZERO : v).setScale(4, RoundingMode.HALF_UP);
    }
}
