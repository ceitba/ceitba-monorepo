package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.kb.KbFileDigest;
import org.ceitba.api.domain.kb.KbHiddenReason;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.kb.KbPageType;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.domain.kb.KbRunRequest;
import org.ceitba.api.domain.kb.KbRunSubject;
import org.ceitba.api.domain.kb.KbRunSubjectId;
import org.ceitba.api.domain.kb.KbSubjectState;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.repository.kb.KbFileDigestRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbRelationRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.repository.kb.KbRunSubjectRepository;
import org.ceitba.api.repository.kb.KbSubjectStateRepository;
import org.ceitba.api.service.kb.KbImportService;
import org.ceitba.api.service.kb.KbLinker;
import org.ceitba.api.service.kb.KbWikilinks;
import org.ceitba.api.service.kb.admin.KbEffectiveSettings;
import org.ceitba.api.service.kb.admin.KbSettingsService;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.web.kb.dto.KbBaselineResponse;
import org.ceitba.api.web.kb.dto.KbBatchJobResponse;
import org.ceitba.api.web.kb.dto.KbImportPage;
import org.ceitba.api.web.kb.dto.KbImportRequest;
import org.ceitba.api.web.kb.dto.KbPreviewResponse;
import org.ceitba.api.web.kb.dto.KbRunResponse;
import org.ceitba.api.web.kb.dto.KbRunSubjectResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// The wiki self-update pipeline (docs/SUBJECT-WIKI-PIPELINE.md), as a
// KbRunHandler on top of KbRunEngine:
//
//   DETECT -> DIGEST -> PLAN -> WRITE -> [RETRY] -> PUBLISH
//
// DETECT diffs every subject's inputs against kb_subject_state (nothing
// dirty: zero requests). DIGEST sends each new content version once (by
// fingerprint). PLAN sees the page index, the digests of the changes and
// the removed files, never page bodies or unchanged files. WRITE sees raw
// excerpts only of the added/changed files a page draws on. LINK and
// VALIDATE run in code; PUBLISH goes through the import service, one
// transaction per subject, and records the inputs used. Models come from
// the runtime settings at each stage's build.
@Service
public class KbPipelineService implements KbRunHandler {

    private static final Logger log = LoggerFactory.getLogger(KbPipelineService.class);

    private final KbRunRepository runs;
    private final KbBatchJobRepository jobs;
    private final KbRunSubjectRepository runSubjects;
    private final KbRunRequestRepository requests;
    private final KbFileDigestRepository digests;
    private final KbSubjectStateRepository states;
    private final KbPageRepository pages;
    private final KbRelationRepository relations;
    private final SubjectRepository subjects;
    private final DriveFileRepository files;
    private final KbInputs inputs;
    private final KbPayloads payloads;
    private final KbImportService importer;
    private final KbRunEngine engine;
    private final KbSettingsService settings;
    private final org.ceitba.api.service.kb.admin.KbForecastService forecast;
    private final org.ceitba.api.service.kb.progress.KbProgressService progressService;
    private final org.springframework.beans.factory.ObjectProvider<org.ceitba.api.service.kb.admin.KbModelCatalogService> catalogPrices;
    private final KbLlmRouter router;
    private final ObjectMapper json;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private volatile ZonedDateTime lastScheduleCheck;

    public KbPipelineService(KbRunRepository runs, KbBatchJobRepository jobs, KbRunSubjectRepository runSubjects,
                             KbRunRequestRepository requests, KbFileDigestRepository digests,
                             KbSubjectStateRepository states, KbPageRepository pages, KbRelationRepository relations,
                             SubjectRepository subjects, DriveFileRepository files, KbInputs inputs,
                             KbPayloads payloads, KbImportService importer, KbRunEngine engine,
                             KbSettingsService settings, org.ceitba.api.service.kb.admin.KbForecastService forecast,
                             org.ceitba.api.service.kb.progress.KbProgressService progressService,
                             org.springframework.beans.factory.ObjectProvider<org.ceitba.api.service.kb.admin.KbModelCatalogService> catalogPrices,
                             KbLlmRouter router, ObjectMapper json,
                             ApplicationEventPublisher events, Clock clock) {
        this.runs = runs;
        this.jobs = jobs;
        this.runSubjects = runSubjects;
        this.requests = requests;
        this.digests = digests;
        this.states = states;
        this.pages = pages;
        this.relations = relations;
        this.subjects = subjects;
        this.files = files;
        this.inputs = inputs;
        this.payloads = payloads;
        this.importer = importer;
        this.engine = engine;
        this.settings = settings;
        this.forecast = forecast;
        this.progressService = progressService;
        this.catalogPrices = catalogPrices;
        this.router = router;
        this.json = json;
        this.events = events;
        this.clock = clock;
    }

    // ==== API ====================================================================

    // Published after a run is created or unblocked: advance it in the background.
    public record RunTriggered(UUID runId) {}

    // Creates a run (409 KB_RUN_ACTIVE when one is active; 503
    // KB_LLM_UNCONFIGURED without inference unless dry) and starts it.
    public KbRunResponse trigger(String trigger, boolean dryRun) {
        if (!dryRun && !router.available()) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Inference is not configured (KB_LLM_API_KEY); only dry runs are possible");
        }
        var s = settings.effective();
        var run = engine.inTx(() -> {
            if (!runs.findByStatusInAndTriggerNot(KbRunEngine.ACTIVE, "EVAL").isEmpty()) {
                throw new KbPipelineException(KbPipelineException.Reason.RUN_ACTIVE, "A pipeline run is already active");
            }
            return runs.saveAndFlush(new KbRun(trigger, dryRun, KbPayloads.PROMPT_VERSION,
                s.modelDigest() + "|" + s.modelPlan() + "|" + s.modelWrite(), now(), json.createObjectNode()));
        });
        log.info("KB pipeline: run {} started ({}, dryRun={})", run.getId(), trigger, dryRun);
        events.publishEvent(new RunTriggered(run.getId()));
        return summary(run, false);
    }

    public List<KbRunResponse> runs(int limit) {
        return engine.inTx(() -> runs.findByTriggerNotOrderByStartedAtDesc("EVAL",
                PageRequest.of(0, Math.max(1, Math.min(limit, 100))))
            .stream().map(r -> summary(r, false)).toList());
    }

    public KbRunResponse run(UUID id) {
        return engine.inTx(() -> detail(runs.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("KbRun", id.toString()))));
    }

    public org.ceitba.api.web.kb.dto.KbProgressResponse progress(UUID id) {
        engine.inTx(() -> runs.findById(id).filter(r -> !r.isEval())
            .orElseThrow(() -> new ResourceNotFoundException("KbRun", id.toString())));
        return progressService.progress(id);
    }

    public KbRunResponse cancel(UUID id) {
        engine.cancel(id);
        return engine.inTx(() -> {
            var r = runs.findById(id).orElseThrow();
            refreshSummary(r);
            return detail(r);
        });
    }

    public KbRunResponse approveCost(UUID id) {
        engine.approveCost(id);
        events.publishEvent(new RunTriggered(id));
        return run(id);
    }

    // Weekly schedule (runtime settings: enabled + cron, Buenos Aires time),
    // checked every minute by KbPipelineJob.
    public void schedulerTick() {
        var s = settings.effective();
        var now = ZonedDateTime.now(clock.withZone(ClockConfig.ZONE));
        var last = lastScheduleCheck;
        lastScheduleCheck = now;
        if (last == null || !s.enabled() || !CronExpression.isValidExpression(s.cron())) return;
        var next = CronExpression.parse(s.cron()).next(last);
        if (next == null || next.isAfter(now)) return;
        if (s.autoRefreshPrices()) {
            try {
                catalogPrices.ifAvailable(c -> c.sync("do-catalog"));   // weekly price refresh, same history
            } catch (RuntimeException e) {
                log.warn("KB pipeline: price refresh before the scheduled run failed: {}", e.getMessage());
            }
        }
        try {
            trigger("SCHEDULED", false);
        } catch (KbPipelineException e) {
            log.warn("KB pipeline: scheduled run skipped: {}", e.getMessage());
        }
    }

    // Records the current inputs of every subject with kb pages as compiled
    // (once, after the hand-written import).
    public KbBaselineResponse baseline() {
        return engine.inTx(() -> {
            var current = inputs.current();
            var out = new ArrayList<String>();
            for (var subject : inputs.subjectsWithPages()) {
                var in = inputs.toJson(current.getOrDefault(subject, List.of()));
                var state = states.findById(subject).orElseGet(() -> new KbSubjectState(subject));
                state.compiled(KbInputs.hash(in), in, now(), null);
                states.save(state);
                out.add(subject);
            }
            log.info("KB pipeline: baseline recorded for {} subjects", out.size());
            return new KbBaselineResponse(out);
        });
    }

    // What the next run would do; never calls the LLM.
    public KbPreviewResponse preview() {
        return engine.inTx(() -> {
            var s = settings.effective();
            var diffs = inputs.diffs(s::paused);
            var dirty = diffs.stream().filter(KbInputs.Diff::dirty)
                .sorted(Comparator.comparingLong(KbInputs.Diff::priority).reversed()).toList();
            var fps = new HashSet<String>();
            for (var d : dirty) {
                for (var i : d.added()) fps.add(fingerprintOf(i));
                for (var i : d.changed()) fps.add(fingerprintOf(i));
            }
            var known = new HashSet<String>();
            if (!fps.isEmpty()) {
                digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
                    .forEach(dg -> known.add(dg.getContentFingerprint()));
            }
            var names = subjectNames(dirty.stream().map(KbInputs.Diff::subjectId).toList());
            var planned = new HashSet<String>();
            long total = 0;
            var out = new ArrayList<KbPreviewResponse.Subject>();
            for (var d : dirty) {
                var added = new ArrayList<KbPreviewResponse.File>();
                var changed = new ArrayList<KbPreviewResponse.File>();
                long est = 0;
                int needed = 0;
                for (var list : List.of(d.added(), d.changed())) {
                    for (var i : list) {
                        var fp = fingerprintOf(i);
                        boolean needs = !known.contains(fp) && planned.add(fp);
                        if (needs) {
                            needed++;
                            est += (long) Math.ceil(i.chars() / 3.5);
                        }
                        var f = new KbPreviewResponse.File(i.fileId().toString(), i.name(), i.academicYear(), i.chars(), needs);
                        (list == d.added() ? added : changed).add(f);
                    }
                }
                // PLAN (index + digests) and WRITE (~6k tokens per touched page), roughly.
                int pageCount = pages.findBySubjectIdAndStatusIn(d.subjectId(),
                    List.of(KbPageStatus.PUBLISHED, KbPageStatus.HIDDEN)).size();
                int touched = d.added().size() + d.changed().size() + d.removed().size() + (pageCount == 0 ? 1 : 0);
                est += 2000 + 150L * pageCount + 800L * (d.added().size() + d.changed().size());
                est += 6000L * touched;
                total += est;
                out.add(new KbPreviewResponse.Subject(d.subjectId(), names.get(d.subjectId()), d.hasState(), added,
                    changed, d.removed().stream().map(UUID::toString).toList(), needed, est));
            }
            return new KbPreviewResponse(out, diffs.size() - dirty.size(), total, s.runTokenBudget());
        });
    }

    // ==== KbRunHandler ==============================================================

    @Override
    public boolean handles(KbRun run) {
        return !run.isEval();
    }

    // DETECT: the dirty subjects (nothing dirty: the run ends with zero requests).
    @Override
    public void detect(KbRun run) {
        var s = settings.effective();
        run.setExpectedCostUsd(forecast.nextRunTotal(s));
        var dirty = inputs.diffs(s::paused).stream().filter(KbInputs.Diff::dirty)
            .sorted(Comparator.comparingLong(KbInputs.Diff::priority).reversed()).toList();
        for (var d : dirty) {
            var removed = json.createArrayNode();
            d.removed().forEach(id -> removed.add(id.toString()));
            runSubjects.save(new KbRunSubject(run.getId(), d.subjectId(), s.writeModelFor(d.subjectId()),
                d.priority(), inputs.toJson(d.current()), inputs.toJson(d.added()), inputs.toJson(d.changed()),
                removed, json.createArrayNode(), json.createObjectNode()));
        }
        if (dirty.isEmpty()) {
            run.setStage("DONE");
            run.finish("SUCCEEDED", now());
            log.info("KB pipeline: run {}: nothing changed", run.getId());
        } else {
            run.setStage("DIGEST");
            log.info("KB pipeline: run {}: {} dirty subjects", run.getId(), dirty.size());
        }
        runSubjects.flush();
        refreshSummary(run);
    }

    // Requests of the stage, within the run's token budget (subjects that
    // don't fit are DEFERRED and stay dirty).
    @Override
    public int build(KbRun run, String stage, KbRunEngine.Seq seq) {
        var s = settings.effective();
        var active = runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.getId()).stream()
            .filter(KbRunSubject::isActive).toList();
        int built = 0;
        Set<String> plannedFingerprints = new HashSet<>();
        for (var rs : active) {
            var before = new HashSet<>(plannedFingerprints);
            List<KbRunRequest> mine = switch (stage) {
                case "DIGEST" -> digestRequests(run, rs, plannedFingerprints, seq, s);
                case "PLAN" -> planRequests(run, rs, seq, s);
                case "WRITE" -> writeRequests(run, rs, seq, s);
                case "RETRY" -> retryRequests(run, rs, seq, s);
                default -> List.of();
            };
            long est = mine.stream().mapToLong(KbRunRequest::getEstTokens).sum();
            if (!mine.isEmpty() && run.getEstimatedTokens() + est > s.runTokenBudget()) {
                rs.setStatus("DEFERRED");
                plannedFingerprints.retainAll(before);
                log.info("KB pipeline: run {}: {} deferred (token budget)", run.getId(), rs.getSubjectId());
                continue;
            }
            run.addEstimated(est);
            requests.saveAll(mine);
            built += mine.size();
        }
        refreshSummary(run);
        return built;
    }

    @Override
    public void after(KbRun run, String stage) {
        var rows = requests.findByRunIdAndStage(run.getId(), stage);
        var active = runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.getId()).stream()
            .filter(KbRunSubject::isActive).toList();
        switch (stage) {
            case "DIGEST" -> {
                storeDigests(run, rows, active);
                run.setStage("PLAN");
            }
            case "PLAN" -> {
                for (var rs : active) {
                    var row = rows.stream().filter(r -> r.getSubjectId().equals(rs.getSubjectId())).findFirst();
                    if (row.isEmpty() || run.isDryRun()) continue;   // no-LLM plan, or dry
                    if (row.get().getStatus().equals("DONE")) {
                        rs.setOperations(validateOps(rs, row.get().getResult().path("operations"),
                            livePages(rs.getSubjectId())));
                    } else {
                        rs.fail("PLAN: " + row.get().getError());
                    }
                }
                if (run.isDryRun()) {
                    active.forEach(rs -> { if (rs.isActive()) rs.setStatus("DRY"); });
                    run.setStage("DONE");
                    run.finish(outcome(run.getId()), now());
                } else {
                    run.setStage("WRITE");
                }
            }
            case "WRITE", "RETRY" -> {
                var today = LocalDate.now(clock.withZone(ClockConfig.ZONE));
                for (var rs : active) {
                    Map<String, String> contents = new LinkedHashMap<>();
                    rs.getDrafts().fields().forEachRemaining(e -> {
                        if (e.getValue().path("origin").asText().equals("write")) {
                            contents.put(e.getKey(), e.getValue().path("content").asText());
                        }
                    });
                    var failed = new LinkedHashMap<String, String>();
                    for (var r : rows) {
                        if (!r.getSubjectId().equals(rs.getSubjectId())) continue;
                        if (!r.getStatus().equals("DONE")) {
                            if (stage.equals("WRITE")) failed.put(r.getTarget(), "no answer from the model: " + r.getError());
                            continue;
                        }
                        var op = operation(rs, r.getTarget());
                        var markdown = r.getResult().isTextual() ? r.getResult().asText()
                            : r.getResult().path("markdown").asText("");
                        var type = op == null ? KbPageType.CONCEPT
                            : KbPageType.valueOf(op.path("type").asText("concept").toUpperCase(Locale.ROOT));
                        contents.put(r.getTarget(), KbPageFiles.normalize(markdown, rs.getSubjectId(), type,
                            op == null ? r.getTarget() : op.path("title").asText(r.getTarget()),
                            "do:" + r.getModel(), today));
                    }
                    validateSubject(rs, contents, failed);
                }
                boolean retry = stage.equals("WRITE") && settings.effective().retryRejected() && active.stream()
                    .anyMatch(rs -> hasRejectedDraft(rs.getDrafts()));
                run.setStage(retry ? "RETRY" : "PUBLISH");
            }
            default -> { }
        }
        refreshSummary(run);
    }

    // PUBLISH: one transaction per subject; a failure leaves that subject dirty.
    @Override
    public void complete(UUID runId) {
        var ids = engine.inTx(() -> runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId).stream()
            .filter(KbRunSubject::isActive).map(KbRunSubject::getSubjectId).toList());
        for (var subjectId : ids) {
            try {
                engine.inTxVoid(() -> publishSubject(runId, subjectId));
            } catch (RuntimeException e) {
                log.error("KB pipeline: publishing {} failed", subjectId, e);
                engine.inTxVoid(() -> runSubjects.findById(new KbRunSubjectId(runId, subjectId))
                    .ifPresent(rs -> rs.fail("PUBLISH: " + e.getMessage())));
            }
        }
        engine.inTxVoid(() -> {
            var run = runs.findById(runId).orElseThrow();
            run.setStage("DONE");
            run.finish(outcome(runId), now());
            refreshSummary(run);
            log.info("KB pipeline: run {} done ({} in / {} out tokens, US${})", runId, run.getTokensIn(),
                run.getTokensOut(), run.getCostEstimate());
        });
    }

    // FAILED when every subject the run worked on failed, PARTIAL when some
    // did, else SUCCEEDED (deferred and cancelled subjects don't count).
    private String outcome(UUID runId) {
        var worked = runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(runId).stream()
            .filter(rs -> !List.of("DEFERRED", "CANCELLED").contains(rs.getStatus())).toList();
        long failed = worked.stream().filter(rs -> rs.getStatus().equals("FAILED")).count();
        return KbRunOutcome.status(worked.size(), failed);
    }

    // ==== building requests ==========================================================

    // DIGEST: chunks of added/changed files whose content has no digest yet
    // (by fingerprint, so the same content elsewhere is not digested again).
    private List<KbRunRequest> digestRequests(KbRun run, KbRunSubject rs, Set<String> planned, KbRunEngine.Seq seq,
                                             KbEffectiveSettings s) {
        var candidates = new ArrayList<JsonNode>();
        rs.getAdded().forEach(candidates::add);
        rs.getChanged().forEach(candidates::add);
        if (candidates.isEmpty()) return List.of();
        var fps = new HashSet<String>();
        candidates.forEach(c -> fps.add(fingerprintOf(c)));
        var known = new HashSet<String>();
        digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)
            .forEach(d -> known.add(d.getContentFingerprint()));
        var need = new ArrayList<UUID>();
        for (var c : candidates) {
            var fp = fingerprintOf(c);
            if (known.contains(fp) || planned.contains(fp)) continue;
            planned.add(fp);
            need.add(UUID.fromString(c.path("fileId").asText()));
        }
        var out = new ArrayList<KbRunRequest>();
        for (DriveFile f : files.findAllById(need)) {
            var chunks = KbPayloads.chunks(f.getTextContent());
            for (int i = 0; i < chunks.size(); i++) {
                var text = "Archivo: " + f.getName() + " (parte " + (i + 1) + "/" + chunks.size() + ")\n\n" + chunks.get(i);
                var params = payloads.tuned(s.modelDigest(), "DIGEST", s, null, text);
                var r = engine.request(run, rs.getSubjectId(), "DIGEST", f.getId().toString(), i, s.modelDigest(), params, seq);
                out.add(r);
            }
        }
        out.sort(Comparator.comparing(KbRunRequest::getItemKey));
        return out;
    }

    // PLAN: one request per subject, with its page index (no bodies), the
    // digests of added/changed files, removed files with their citing
    // pages, and the page index of up to 8 related subjects. Subjects with
    // only removals whose citing pages lost every source need no LLM.
    private List<KbRunRequest> planRequests(KbRun run, KbRunSubject rs, KbRunEngine.Seq seq, KbEffectiveSettings s) {
        var subjectId = rs.getSubjectId();
        var existing = livePages(subjectId);
        var removed = new HashSet<String>();
        rs.getRemoved().forEach(n -> removed.add(n.asText()));
        boolean onlyRemovals = rs.getAdded().isEmpty() && rs.getChanged().isEmpty();
        if (onlyRemovals) {
            boolean trivial = existing.stream()
                .filter(p -> p.getSources().stream().anyMatch(id -> removed.contains(id.toString())))
                .allMatch(p -> p.getSources().stream().allMatch(id -> removed.contains(id.toString())));
            if (trivial) {
                rs.setOperations(validateOps(rs, json.createArrayNode(), existing));
                return List.of();
            }
        }
        // Stable first (subject, its page index, related subjects), changes last.
        var stable = json.createObjectNode();
        stable.putObject("subject").put("id", subjectId).put("name", subjectName(subjectId));
        stable.put("hasIndex", existing.stream().anyMatch(p -> p.getType() == KbPageType.INDEX));
        var pageArr = stable.putArray("pages");
        for (var p : existing) pageArr.add(pageIndexEntry(p, true));
        var relatedArr = stable.putArray("related");
        int n = 0;
        for (var rel : relations.findBySubject(subjectId)) {
            if (n >= 8) break;
            var relPages = livePages(rel.relatedId()).stream().filter(p -> p.getStatus() == KbPageStatus.PUBLISHED).toList();
            if (relPages.isEmpty()) continue;
            n++;
            var o = relatedArr.addObject();
            o.put("subjectId", rel.relatedId());
            o.put("name", subjectName(rel.relatedId()));
            var arr = o.putArray("pages");
            for (var p : relPages) arr.add(pageIndexEntry(p, false));
        }
        var body = json.createObjectNode();
        var changedArr = body.putArray("addedOrChanged");
        var fileById = fileMap(rs);
        var digestByFp = digestsFor(rs);
        for (var list : List.of(rs.getAdded(), rs.getChanged())) {
            for (var c : list) {
                var o = changedArr.addObject();
                o.put("fileId", c.path("fileId").asText());
                var f = fileById.get(UUID.fromString(c.path("fileId").asText()));
                o.put("name", f == null ? null : f.getName());
                o.set("academicYear", c.path("academicYear"));
                var d = digestByFp.get(fingerprintOf(c));
                o.set("digest", d == null ? null : d.getDigest());
            }
        }
        var removedArr = body.putArray("removed");
        Map<UUID, DriveFile> removedFiles = new HashMap<>();
        files.findAllById(removed.stream().map(UUID::fromString).toList()).forEach(f -> removedFiles.put(f.getId(), f));
        for (var id : removed) {
            var o = removedArr.addObject();
            o.put("fileId", id);
            var f = removedFiles.get(UUID.fromString(id));
            o.put("name", f == null ? "(archivo borrado)" : f.getName());
            var citedBy = o.putArray("citedBy");
            existing.stream().filter(p -> p.getSources().contains(UUID.fromString(id))).forEach(p -> citedBy.add(p.getSlug()));
        }
        var model = s.planModelFor(subjectId);
        var params = payloads.tuned(model, "PLAN", s, payloads.toJson(stable), payloads.toJson(body));
        return List.of(engine.request(run, subjectId, "PLAN", subjectId, 0, model, params, seq));
    }

    // WRITE: one request per create/update operation. Raw text only from the
    // added/changed files the page draws on; unchanged sources appear by name.
    private List<KbRunRequest> writeRequests(KbRun run, KbRunSubject rs, KbRunEngine.Seq seq, KbEffectiveSettings s) {
        var subjectId = rs.getSubjectId();
        var existing = livePages(subjectId);
        Map<String, KbPage> bySlug = new HashMap<>();
        existing.forEach(p -> bySlug.put(p.getSlug(), p));
        var changedIds = new HashSet<String>();
        rs.getAdded().forEach(c -> changedIds.add(c.path("fileId").asText()));
        rs.getChanged().forEach(c -> changedIds.add(c.path("fileId").asText()));
        var removed = new HashSet<String>();
        rs.getRemoved().forEach(n -> removed.add(n.asText()));
        var fileById = fileMap(rs);
        var digestByFp = digestsFor(rs);
        Map<String, JsonNode> inputById = new HashMap<>();
        rs.getInputs().forEach(i -> inputById.put(i.path("fileId").asText(), i));
        // Stable first (subject and its page index: the same for every page of
        // the subject, so providers can cache it), the page's material last.
        var stable = json.createObjectNode();
        stable.putObject("subject").put("id", subjectId).put("name", subjectName(subjectId));
        stable.set("pages", subjectIndex(existing, rs.getOperations()));

        var out = new ArrayList<KbRunRequest>();
        for (var op : rs.getOperations()) {
            var kind = op.path("op").asText();
            if (kind.equals("delete")) continue;
            var slug = op.path("slug").asText();
            var current = bySlug.get(slug);
            var body = json.createObjectNode();
            body.put("slug", slug);
            body.put("type", op.path("type").asText());
            body.put("title", op.path("title").asText());
            body.put("reason", op.path("reason").asText(""));
            var changedSources = body.putArray("changedSources");
            var keptSources = body.putArray("keptSources");
            var sourceTexts = new ArrayList<KbPayloads.SourceText>();
            var keywords = new LinkedHashSet<String>();
            keywords.add(op.path("title").asText());
            for (var src : op.path("sources")) {
                var id = src.asText();
                var f = fileById.get(UUID.fromString(id));
                var name = f == null ? id : f.getName();
                if (changedIds.contains(id)) {
                    var o = changedSources.addObject();
                    o.put("fileId", id);
                    o.put("name", name);
                    o.set("academicYear", inputById.getOrDefault(id, json.createObjectNode()).path("academicYear"));
                    var d = digestByFp.get(fingerprintOf(inputById.getOrDefault(id, json.createObjectNode())));
                    o.set("digest", d == null ? null : d.getDigest());
                    if (d != null) {
                        for (var t : d.getDigest().path("topics")) keywords.add(t.path("name").asText());
                    }
                    if (f != null && f.getTextContent() != null) {
                        sourceTexts.add(new KbPayloads.SourceText(id, name, f.getTextContent()));
                    }
                } else {
                    keptSources.addObject().put("fileId", id).put("name", name);
                }
            }
            var excerpts = body.putArray("excerpts");
            for (var e : KbPayloads.excerpts(sourceTexts, keywords)) {
                excerpts.addObject().put("fileId", e.fileId()).put("name", e.name()).put("text", e.text());
            }
            var removedArr = body.putArray("removedSources");
            if (current != null) {
                for (var id : current.getSources()) {
                    if (removed.contains(id.toString())) removedArr.add(id.toString());
                }
            }
            body.put("currentPage", current == null ? null : KbPageFiles.of(current));
            var model = s.writeModelFor(subjectId);
            var params = payloads.tuned(model, "WRITE", s, payloads.toJson(stable), payloads.toJson(body));
            out.add(engine.request(run, subjectId, "WRITE", slug, 0, model, params, seq));
        }
        return out;
    }

    // RETRY: the rejected drafts with their validator errors.
    private List<KbRunRequest> retryRequests(KbRun run, KbRunSubject rs, KbRunEngine.Seq seq, KbEffectiveSettings s) {
        if (!s.retryRejected()) return List.of();
        var out = new ArrayList<KbRunRequest>();
        var allowed = json.createArrayNode();
        var fileById = fileMap(rs);
        for (var i : rs.getInputs()) {
            var f = fileById.get(UUID.fromString(i.path("fileId").asText()));
            allowed.addObject().put("fileId", i.path("fileId").asText()).put("name", f == null ? null : f.getName());
        }
        var stable = json.createObjectNode();
        stable.putObject("subject").put("id", rs.getSubjectId()).put("name", subjectName(rs.getSubjectId()));
        stable.set("pages", subjectIndex(livePages(rs.getSubjectId()), rs.getOperations()));
        rs.getDrafts().fields().forEachRemaining(e -> {
            var d = e.getValue();
            if (!d.path("origin").asText().equals("write") || d.path("errors").isEmpty()) return;
            var body = json.createObjectNode();
            body.put("slug", e.getKey());
            body.set("errors", d.path("errors"));
            body.put("page", d.path("content").asText());
            body.set("allowedSources", allowed);
            var model = s.retryModelFor(rs.getSubjectId());
            var params = payloads.tuned(model, "RETRY", s, payloads.toJson(stable), payloads.toJson(body));
            out.add(engine.request(run, rs.getSubjectId(), "RETRY", e.getKey(), 0, model, params, seq));
        });
        return out;
    }

    // ==== after each stage ===========================================================

    private static boolean hasRejectedDraft(JsonNode drafts) {
        var it = drafts.elements();
        while (it.hasNext()) {
            var d = it.next();
            if (d.path("origin").asText().equals("write") && !d.path("errors").isEmpty()) return true;
        }
        return false;
    }

    // Merges each fully digested file (all chunks DONE) into kb_file_digest;
    // subjects needing a file whose digest failed fail (and stay dirty).
    private void storeDigests(KbRun run, List<KbRunRequest> rows, List<KbRunSubject> active) {
        Map<String, List<KbRunRequest>> byFile = new LinkedHashMap<>();
        for (var r : rows) byFile.computeIfAbsent(r.getTarget(), k -> new ArrayList<>()).add(r);
        var failedFiles = new HashSet<String>();
        for (var e : byFile.entrySet()) {
            var chunks = e.getValue().stream().sorted(Comparator.comparingInt(KbRunRequest::getChunk)).toList();
            if (run.isDryRun()) continue;
            if (chunks.stream().anyMatch(c -> !c.getStatus().equals("DONE"))) {
                failedFiles.add(e.getKey());
                continue;
            }
            var file = files.findById(UUID.fromString(e.getKey())).orElse(null);
            if (file == null) continue;
            var fp = fingerprintOf(file.getId(), file.getContentFingerprint());
            if (!digests.findByContentFingerprintInAndPromptVersion(List.of(fp), KbPayloads.PROMPT_VERSION).isEmpty()) {
                continue;
            }
            int in = chunks.stream().mapToInt(KbRunRequest::getTokensIn).sum();
            int out = chunks.stream().mapToInt(KbRunRequest::getTokensOut).sum();
            digests.save(new KbFileDigest(file.getId(), fp, KbPayloads.PROMPT_VERSION, chunks.get(0).getModel(),
                KbDigests.merge(chunks.stream().map(KbRunRequest::getResult).toList(), json), in, out));
        }
        if (failedFiles.isEmpty()) return;
        for (var rs : active) {
            var needs = new HashSet<String>();
            rs.getAdded().forEach(c -> needs.add(c.path("fileId").asText()));
            rs.getChanged().forEach(c -> needs.add(c.path("fileId").asText()));
            needs.retainAll(failedFiles);
            if (!needs.isEmpty()) rs.fail("DIGEST failed for " + needs);
        }
    }

    // The PLAN's operations made safe: known slugs only, sources limited to
    // the subject's current inputs, creates of existing slugs become updates;
    // pages that lost all their sources are deleted and pages that lost some
    // are updated even if the model forgot them.
    JsonNode validateOps(KbRunSubject rs, JsonNode proposed, List<KbPage> existing) {
        var valid = new HashSet<String>();
        rs.getInputs().forEach(i -> valid.add(i.path("fileId").asText()));
        Map<String, KbPage> bySlug = new HashMap<>();
        existing.forEach(p -> bySlug.put(p.getSlug(), p));
        var out = json.createArrayNode();
        var seen = new HashSet<String>();
        for (var op : proposed) {
            var kind = op.path("op").asText("").toLowerCase(Locale.ROOT);
            var slug = op.path("slug").asText("").trim();
            if (!KbWikilinks.SLUG.matcher(slug).matches() || slug.equals("graph") || !seen.add(slug)) continue;
            var current = bySlug.get(slug);
            if (kind.equals("create") && current != null) kind = "update";
            if (!List.of("create", "update", "delete").contains(kind)) continue;
            if (!kind.equals("create") && current == null) continue;
            var o = json.createObjectNode();
            o.put("op", kind);
            o.put("slug", slug);
            if (kind.equals("delete")) {
                o.put("reason", op.path("reason").asText(""));
                out.add(o);
                continue;
            }
            var type = current != null ? current.getType().wire()
                : slug.equals("index") ? "index" : op.path("type").asText("concept");
            if (!List.of("topic", "concept", "index").contains(type) || (type.equals("index") != slug.equals("index"))) {
                type = slug.equals("index") ? "index" : "concept";
            }
            var title = op.path("title").asText("").isBlank()
                ? (current != null ? current.getTitle() : slug.replace('-', ' ')) : op.path("title").asText().trim();
            var sources = json.createArrayNode();
            for (var s : op.path("sources")) if (valid.contains(s.asText())) sources.add(s.asText());
            if (sources.isEmpty() && current != null) {
                for (var id : current.getSources()) if (valid.contains(id.toString())) sources.add(id.toString());
            }
            if (sources.isEmpty()) continue;
            o.put("type", type);
            o.put("title", title);
            o.set("sources", sources);
            o.put("reason", op.path("reason").asText(""));
            out.add(o);
        }
        var removed = new HashSet<String>();
        rs.getRemoved().forEach(n -> removed.add(n.asText()));
        for (var p : existing) {
            if (seen.contains(p.getSlug())) continue;
            var ids = p.getSources().stream().map(UUID::toString).toList();
            if (ids.stream().noneMatch(removed::contains)) continue;
            var left = ids.stream().filter(valid::contains).toList();
            var o = json.createObjectNode();
            o.put("slug", p.getSlug());
            if (left.isEmpty()) {
                o.put("op", "delete");
                o.put("reason", "lost all its sources");
            } else {
                o.put("op", "update");
                o.put("type", p.getType().wire());
                o.put("title", p.getTitle());
                var arr = o.putArray("sources");
                left.forEach(arr::add);
                o.put("reason", "drop removed sources");
            }
            out.add(o);
            seen.add(p.getSlug());
        }
        return out;
    }

    // LINK + VALIDATE: links the drafts and the subject's unchanged pages
    // (deterministic linker), then validates them as an import would.
    // drafts jsonb: {slug: {content, errors, origin: write|link}}.
    private void validateSubject(KbRunSubject rs, Map<String, String> contents, Map<String, String> failed) {
        var subjectId = rs.getSubjectId();
        var deletes = new HashSet<String>();
        for (var op : rs.getOperations()) if (op.path("op").asText().equals("delete")) deletes.add(op.path("slug").asText());
        var existing = livePages(subjectId);
        Map<String, KbLinker.Target> targets = new java.util.TreeMap<>();
        for (var p : existing) {
            if (!deletes.contains(p.getSlug())) {
                targets.put(p.getSlug(), new KbLinker.Target(p.getSlug(), p.getTitle(), p.getAliases()));
            }
        }
        for (var e : contents.entrySet()) {
            var fm = KbPageFiles.split(e.getValue()).frontmatter();
            var title = fm == null ? e.getKey() : String.valueOf(fm.get("title"));
            var aliases = new ArrayList<String>();
            if (fm != null && fm.get("aliases") instanceof java.util.Collection<?> c) c.forEach(a -> aliases.add(String.valueOf(a)));
            targets.put(e.getKey(), new KbLinker.Target(e.getKey(), title, aliases));
        }
        var targetList = List.copyOf(targets.values());

        var payload = new ArrayList<KbImportPage>();
        Map<String, String> origin = new HashMap<>();
        Map<String, String> linked = new LinkedHashMap<>();
        for (var e : contents.entrySet()) {
            var body = KbPageFiles.split(e.getValue()).body();
            var content = KbPageFiles.replaceBody(e.getValue(), KbLinker.link(body, e.getKey(), targetList).body());
            linked.put(e.getKey(), content);
            origin.put(e.getKey(), "write");
        }
        for (var p : existing) {
            if (contents.containsKey(p.getSlug()) || deletes.contains(p.getSlug())) continue;
            var result = KbLinker.link(p.getMarkdown(), p.getSlug(), targetList);
            if (result.addedSlugs().isEmpty()) continue;
            linked.put(p.getSlug(), KbPageFiles.replaceBody(KbPageFiles.of(p), result.body()));
            origin.put(p.getSlug(), "link");
        }
        linked.forEach((slug, content) -> payload.add(new KbImportPage(slug + ".md", content)));
        var v = importer.validate(subjectId, payload, deletes);

        var drafts = json.createObjectNode();
        var errorsBySlug = new HashMap<String, List<String>>();
        v.rejected().forEach(r -> errorsBySlug.put(r.slug(), r.errors()));
        for (var e : linked.entrySet()) {
            var d = drafts.putObject(e.getKey());
            d.put("content", e.getValue());
            d.put("origin", origin.get(e.getKey()));
            var errs = d.putArray("errors");
            errorsBySlug.getOrDefault(e.getKey(), List.of()).forEach(errs::add);
        }
        for (var e : failed.entrySet()) {
            var d = drafts.putObject(e.getKey());
            d.putNull("content");
            d.put("origin", "failed");
            d.putArray("errors").add(e.getValue());
        }
        rs.setDrafts(drafts);
    }

    // ==== PUBLISH ======================================================================

    private void publishSubject(UUID runId, String subjectId) {
        var rs = runSubjects.findById(new org.ceitba.api.domain.kb.KbRunSubjectId(runId, subjectId)).orElseThrow();
        var deleted = json.createArrayNode();
        for (var op : rs.getOperations()) {
            if (!op.path("op").asText().equals("delete")) continue;
            var slug = op.path("slug").asText();
            pages.findBySubjectIdAndSlug(subjectId, slug).ifPresent(p -> {
                if (p.getStatus() != KbPageStatus.REMOVED) {
                    p.setStatus(KbPageStatus.REMOVED);
                    deleted.add(slug);
                }
            });
        }
        pages.flush();
        var payload = new ArrayList<KbImportPage>();
        var rejected = json.createArrayNode();
        rs.getDrafts().fields().forEachRemaining(e -> {
            var d = e.getValue();
            if (d.path("errors").isEmpty() && d.hasNonNull("content")) {
                payload.add(new KbImportPage(e.getKey() + ".md", d.path("content").asText()));
            } else if (!d.path("origin").asText().equals("link")) {
                var r = rejected.addObject();
                r.put("slug", e.getKey());
                r.set("errors", d.path("errors"));
            }
        });
        var accepted = json.createArrayNode();
        if (!payload.isEmpty()) {
            var res = importer.importSubject(subjectId, new KbImportRequest(payload, false));
            res.accepted().forEach(accepted::add);
            for (var r : res.rejected()) {
                var o = rejected.addObject();
                o.put("slug", r.slug());
                var errs = o.putArray("errors");
                r.errors().forEach(errs::add);
            }
            // Rewritten without the taken-down source: back to readers.
            for (var slug : res.accepted()) {
                pages.findBySubjectIdAndSlug(subjectId, slug).ifPresent(p -> {
                    if (p.getStatus() == KbPageStatus.HIDDEN && p.getHiddenReason() == KbHiddenReason.TAKEDOWN) {
                        p.setStatus(KbPageStatus.PUBLISHED);
                    }
                });
            }
        }
        var state = states.findById(subjectId).orElseGet(() -> new KbSubjectState(subjectId));
        state.compiled(KbInputs.hash(rs.getInputs()), rs.getInputs(), now(), runId);
        states.save(state);
        rs.setOutcome(accepted, rejected, deleted);
        rs.setStatus("PUBLISHED");
        log.info("KB pipeline: {} published ({} pages, {} rejected, {} deleted)", subjectId, accepted.size(),
            rejected.size(), deleted.size());
    }

    // ==== helpers ======================================================================

    private List<KbPage> livePages(String subjectId) {
        return pages.findBySubjectIdAndStatusIn(subjectId, List.of(KbPageStatus.PUBLISHED, KbPageStatus.HIDDEN))
            .stream().sorted(Comparator.comparing(KbPage::getSlug)).toList();
    }

    private ObjectNode pageIndexEntry(KbPage p, boolean withSources) {
        var o = json.createObjectNode();
        o.put("slug", p.getSlug());
        o.put("type", p.getType().wire());
        o.put("title", p.getTitle());
        o.put("summary", p.getSummary());
        var aliases = o.putArray("aliases");
        p.getAliases().forEach(aliases::add);
        if (withSources) {
            var s = o.putArray("sources");
            p.getSources().forEach(id -> s.add(id.toString()));
        }
        return o;
    }

    // The subject's pages for links/anchors: existing pages (with their
    // heading anchors) and the ones the plan creates.
    private ArrayNode subjectIndex(List<KbPage> existing, JsonNode ops) {
        var arr = json.createArrayNode();
        var deleted = new HashSet<String>();
        for (var op : ops) if (op.path("op").asText().equals("delete")) deleted.add(op.path("slug").asText());
        var slugs = new HashSet<String>();
        for (var p : existing) {
            if (deleted.contains(p.getSlug())) continue;
            slugs.add(p.getSlug());
            var o = arr.addObject();
            o.put("slug", p.getSlug());
            o.put("title", p.getTitle());
            var aliases = o.putArray("aliases");
            p.getAliases().forEach(aliases::add);
            var anchors = o.putArray("anchors");
            KbWikilinks.headingAnchors(p.getMarkdown()).forEach(anchors::add);
        }
        for (var op : ops) {
            if (!op.path("op").asText().equals("create") || slugs.contains(op.path("slug").asText())) continue;
            var o = arr.addObject();
            o.put("slug", op.path("slug").asText());
            o.put("title", op.path("title").asText());
            o.putArray("aliases");
            o.putArray("anchors");
        }
        return arr;
    }

    private JsonNode operation(KbRunSubject rs, String slug) {
        for (var op : rs.getOperations()) if (op.path("slug").asText().equals(slug)) return op;
        return null;
    }

    private Map<UUID, DriveFile> fileMap(KbRunSubject rs) {
        var ids = new ArrayList<UUID>();
        rs.getInputs().forEach(i -> ids.add(UUID.fromString(i.path("fileId").asText())));
        Map<UUID, DriveFile> out = new HashMap<>();
        files.findAllById(ids).forEach(f -> out.put(f.getId(), f));
        return out;
    }

    private Map<String, KbFileDigest> digestsFor(KbRunSubject rs) {
        var fps = new HashSet<String>();
        rs.getAdded().forEach(c -> fps.add(fingerprintOf(c)));
        rs.getChanged().forEach(c -> fps.add(fingerprintOf(c)));
        Map<String, KbFileDigest> out = new HashMap<>();
        if (fps.isEmpty()) return out;
        for (var d : digests.findByContentFingerprintInAndPromptVersion(fps, KbPayloads.PROMPT_VERSION)) {
            out.putIfAbsent(d.getContentFingerprint(), d);
        }
        return out;
    }

    // Content without a stored fingerprint is keyed by its file.
    static String fingerprintOf(UUID fileId, String fingerprint) {
        return fingerprint != null ? fingerprint : "file:" + fileId;
    }

    private static String fingerprintOf(KbInputs.Input i) {
        return fingerprintOf(i.fileId(), i.fingerprint());
    }

    private static String fingerprintOf(JsonNode input) {
        var fp = input.path("fingerprint");
        return fp.isTextual() ? fp.asText() : "file:" + input.path("fileId").asText();
    }

    private String subjectName(String id) {
        return subjects.findById(id).map(Subject::getName).orElse(id);
    }

    private Map<String, String> subjectNames(List<String> ids) {
        Map<String, String> out = new HashMap<>();
        subjects.findAllById(ids).forEach(s -> out.put(s.getId(), s.getName()));
        return out;
    }

    private void refreshSummary(KbRun run) {
        var arr = json.createArrayNode();
        for (var s : runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.getId())) {
            var o = arr.addObject();
            o.put("subjectId", s.getSubjectId());
            o.put("status", s.getStatus());
            o.put("added", s.getAdded().size());
            o.put("changed", s.getChanged().size());
            o.put("removed", s.getRemoved().size());
            o.put("operations", s.getOperations().size());
            o.put("accepted", s.getAccepted().size());
            o.put("rejected", s.getRejected().size());
        }
        run.setSubjects(arr);
        var stats = json.createObjectNode();
        var byStage = stats.putObject("requests");
        for (var r : requests.findByRunIdAndStage(run.getId(), "DIGEST")) byStage.put("DIGEST", byStage.path("DIGEST").asInt() + 1);
        for (var st : List.of("PLAN", "WRITE", "RETRY")) {
            int n = requests.findByRunIdAndStage(run.getId(), st).size();
            if (n > 0) byStage.put(st, n);
        }
        stats.put("estimatedTokens", run.getEstimatedTokens());
        run.setStats(stats);
    }

    private KbRunResponse summary(KbRun r, boolean full) {
        return new KbRunResponse(r.getId(), r.getTrigger(), r.getStatus(), r.getStage(), r.isDryRun(),
            r.getPromptVersion(), r.getModel(), r.getStartedAt(), r.getFinishedAt(), r.getEstimatedTokens(),
            r.getTokensIn(), r.getTokensOut(), r.getTokensCached(), r.getCostEstimate(), usd(r.getCostEstimate()),
            r.getExpectedCostUsd(),
            full ? costByStage(r) : null, r.isCostApproved(), r.isSimulated(), r.getError(),
            full ? subjectsOf(r) : null, full ? batchesOf(r) : null, full ? progressService.progress(r.getId()) : null);
    }

    private Map<String, BigDecimal> costByStage(KbRun r) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (var st : List.of("DIGEST", "PLAN", "WRITE", "RETRY")) out.put(st, BigDecimal.ZERO.setScale(4));
        for (var j : jobs.findByRunIdOrderByCreatedAtAsc(r.getId())) {
            if (j.getCostEstimate() != null) out.merge(j.getStage(), j.getCostEstimate(), BigDecimal::add);
        }
        out.replaceAll((k, v) -> usd(v));
        return out;
    }

    private static BigDecimal usd(BigDecimal v) {
        return (v == null ? BigDecimal.ZERO : v).setScale(4, java.math.RoundingMode.HALF_UP);
    }

    private KbRunResponse detail(KbRun r) {
        return summary(r, true);
    }

    private List<KbRunSubjectResponse> subjectsOf(KbRun r) {
        var list = runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(r.getId());
        var names = subjectNames(list.stream().map(KbRunSubject::getSubjectId).toList());
        return list.stream().map(s -> new KbRunSubjectResponse(s.getSubjectId(), names.get(s.getSubjectId()),
            s.getStatus(), s.getModel(), ids(s.getAdded()), ids(s.getChanged()), texts(s.getRemoved()),
            s.getOperations(), s.getAccepted(), s.getRejected(), s.getDeleted(), s.getTokensIn(), s.getTokensOut(),
            s.getTokensCached(), s.getCostEstimate(), usd(s.getCostEstimate()), s.getError())).toList();
    }

    private static List<String> ids(JsonNode inputs) {
        var out = new ArrayList<String>();
        inputs.forEach(i -> out.add(i.path("fileId").asText()));
        return out;
    }

    private static List<String> texts(JsonNode arr) {
        var out = new ArrayList<String>();
        arr.forEach(i -> out.add(i.asText()));
        return out;
    }

    private List<KbBatchJobResponse> batchesOf(KbRun r) {
        return jobs.findByRunIdOrderByCreatedAtAsc(r.getId()).stream()
            .map(j -> new KbBatchJobResponse(j.getId(), j.getStage(), j.getAttempt(), j.getModel(), j.getMode(),
                j.getStatus(), j.getRequestCount(), j.getDoBatchId(), j.getPayloadKey(), j.getOutputKey(),
                j.getTokensIn(), j.getTokensOut(), j.getTokensCached(), j.getCostEstimate(), usd(j.getCostEstimate()),
                j.getSubmittedAt(),
                j.getCompletedAt(), j.getError(), j.getNextAttemptAt()))
            .toList();
    }


    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }
}
