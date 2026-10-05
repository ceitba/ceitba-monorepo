package org.ceitba.api.service.kb.admin;

import org.ceitba.api.service.kb.llm.KbEndpointRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.external.llm.DoBatchErrors;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbChatPayloads;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.service.kb.llm.KbUsageRecorder;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
import org.ceitba.api.service.kb.pipeline.KbBatchSubmitter;
import org.ceitba.api.service.kb.pipeline.KbPayloads;
import org.ceitba.api.service.kb.pipeline.KbPipelineException;
import org.ceitba.api.external.llm.LlmOutputParser;
import org.ceitba.api.web.kb.admin.KbModelResponse;
import org.ceitba.api.web.kb.admin.KbModelSyncResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// Model catalog (docs/SUBJECT-WIKI-ADMIN.md §2): prices, enable/disable,
// sync with DO's model list, and probes (one tiny structured-output request
// through the model's execution mode). A probe in BATCH mode is pending
// until KbPipelineJob sees its batch finished.
@Service
public class KbModelCatalogService {

    private static final Logger log = LoggerFactory.getLogger(KbModelCatalogService.class);
    private static final Set<String> TOOL_CALLING = Set.of("unknown", "yes", "no");

    private final KbModelRepository models;
    private final org.ceitba.api.repository.kb.KbRunRequestRepository requests;
    private final KbSettingsService settings;
    private final KbLlmRouter router;
    private final SyncLlmExecutor sync;
    private final BatchLlmExecutor batch;
    private final SyncChatClient chat;
    private final KbPayloads payloads;
    private final KbUsageRecorder usage;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;

    private final org.ceitba.api.external.llm.DoModelCatalog doCatalog;
    private final org.ceitba.api.repository.kb.KbModelPriceHistoryRepository priceHistory;

    public KbModelCatalogService(KbModelRepository models,
                                 org.ceitba.api.repository.kb.KbRunRequestRepository requests, KbSettingsService settings, KbLlmRouter router,
                                 SyncLlmExecutor sync, BatchLlmExecutor batch, SyncChatClient chat,
                                 KbPayloads payloads, KbUsageRecorder usage, TransactionTemplate tx,
                                 ObjectMapper json, Clock clock, org.ceitba.api.external.llm.DoModelCatalog doCatalog,
                                 org.ceitba.api.repository.kb.KbModelPriceHistoryRepository priceHistory) {
        this.doCatalog = doCatalog;
        this.priceHistory = priceHistory;
        this.models = models;
        this.requests = requests;
        this.settings = settings;
        this.router = router;
        this.sync = sync;
        this.batch = batch;
        this.chat = chat;
        this.payloads = payloads;
        this.usage = usage;
        this.tx = tx;
        this.json = json;
        this.clock = clock;
    }

    public List<KbModelResponse> list() {
        return tx.execute(s -> {
            var rates = emptyToolCallRates();
            return models.findAllByOrderByIdAsc().stream().map(m -> view(m, rates.get(m.getId()))).toList();
        });
    }

    // model -> share of its last 200 structured requests with an empty/
    // unparseable or truncated answer (including those a doubled max_tokens
    // retry saved).
    private java.util.Map<String, Double> emptyToolCallRates() {
        var out = new java.util.HashMap<String, Double>();
        for (Object[] r : requests.emptyToolCallStats()) {
            long total = ((Number) r[1]).longValue();
            if (total > 0) out.put((String) r[0], Math.round(((Number) r[2]).doubleValue() / total * 10000) / 10000.0);
        }
        return out;
    }

    public KbModelResponse update(String id, JsonNode body) {
        return tx.execute(s -> {
            var m = models.findById(id).orElseThrow(() -> new ResourceNotFoundException("KbModel", id));
            apply(m, body);
            return view(m);
        });
    }

    public KbModelResponse create(JsonNode body) {
        var id = body.path("id").asText("").trim();
        if (id.isEmpty() || id.length() > 128) throw new ValidationException("id", id, "required (max 128 chars)");
        if (!KbEndpointRegistry.SAFE_ID.matcher(id).matches()) {
            throw new ValidationException("id", id, "only letters, digits and . _ : - (it goes in URL paths)");
        }
        if (KbEndpointRegistry.isCustom(id)) {
            throw new ValidationException("id", id, "custom:* ids are created by discovering an endpoint's models");
        }
        return tx.execute(s -> {
            if (models.existsById(id)) throw new ResourceAlreadyExistsException("KbModel", id);
            var provider = provider(id);
            var m = new KbModel(id, body.path("displayName").asText(id), provider,
                KbChatPayloads.batchByRule(id), true);
            m.setSupportsReasoningEffort(id.startsWith("glm"));
            apply(m, body);
            return view(models.save(m));
        });
    }

    // Adds the ids DO lists that the catalog lacks (disabled, no price).
    // POST /models/sync (ADMIN doc §2): prices, context and names from DO's
    // public catalog onto matching models (history per change), missing
    // serverless chat models added disabled. Capabilities are hints only:
    // probes win. Never touches batchDiscount, batchSupported, enabled or
    // past costs. Without the catalog: ids from /v1/models only.
    public KbModelSyncResponse sync() {
        return sync("do-catalog");
    }

    public KbModelSyncResponse sync(String historySource) {
        List<JsonNode> items;
        try {
            items = doCatalog.fetch();
        } catch (org.ceitba.api.external.llm.LlmApiException e) {
            log.warn("KB catalog: DO model catalog unavailable ({}); falling back to /v1/models", e.getMessage());
            return syncIds();
        }
        var now = OffsetDateTime.now(clock);
        var parsed = items.stream().map(KbCatalogItem::of).filter(c -> c.id() != null && c.id().length() <= 128).toList();
        return tx.execute(s -> {
            Map<String, KbModel> existing = new java.util.LinkedHashMap<>();
            models.findAllByOrderByIdAsc().forEach(m -> existing.put(m.getId(), m));
            var updated = new ArrayList<KbModelSyncResponse.Updated>();
            var added = new ArrayList<String>();
            int unchanged = 0;
            var seen = new HashSet<String>();
            var perToken = new ArrayList<String>();
            var perMillion = new ArrayList<String>();
            for (var c : parsed) {
                if (!seen.add(c.id())) continue;
                if (!c.perTokenFields().isEmpty()) perToken.add(c.id());
                else if (c.inputPerM() != null) perMillion.add(c.id());
                var m = existing.get(c.id());
                if (m == null) {
                    if (!c.serverlessChat() || c.inputPerM() == null) continue;
                    if (!KbEndpointRegistry.SAFE_ID.matcher(c.id()).matches()) {
                        log.warn("KB catalog: skipping DO model id with characters that break the /models/{id} routes: {}", c.id());
                        continue;
                    }
                    m = new KbModel(c.id(), c.name() == null ? c.id() : c.name(),
                        c.creator() == null ? provider(c.id()) : c.creator(), KbChatPayloads.batchByRule(c.id()), false);
                    m.setPrices(c.inputPerM(), c.outputPerM(), c.cacheReadPerM(), null, now);
                    m.setContextWindow(c.contextWindow());
                    m.setMaxOutputTokens(c.maxOutputTokens());
                    m.setPriceSource("do-catalog");
                    if (c.has("reasoning")) m.setSupportsReasoningEffort(true);
                    if (c.has("tool_calling")) m.setToolCalling("yes");
                    models.save(m);
                    added.add(c.id());
                    continue;
                }
                var changes = applyCatalog(m, c, now, historySource);
                if (changes.isEmpty()) unchanged++;
                else updated.add(new KbModelSyncResponse.Updated(m.getId(), changes));
            }
            var notInCatalog = existing.keySet().stream().filter(id -> !seen.contains(id)).toList();
            log.info("KB catalog: synced from DO catalog: {} updated, {} added, {} unchanged, {} not in catalog; "
                + "prices given per token (converted x1e6) for {} models, already per million for {}{}",
                updated.size(), added.size(), unchanged, notInCatalog.size(), perToken.size(), perMillion.size(),
                perMillion.isEmpty() ? "" : " " + perMillion);
            return new KbModelSyncResponse(updated, added, unchanged, notInCatalog, "do-catalog", now);
        });
    }

    // Applies one catalog item to an existing model; returns the changes
    // (each also written to kb_model_price_history).
    List<KbModelSyncResponse.Change> applyCatalog(KbModel m, KbCatalogItem c, OffsetDateTime now, String source) {
        var changes = new ArrayList<KbModelSyncResponse.Change>();
        var input = c.inputPerM() != null ? c.inputPerM() : m.getInputPerM();
        var output = c.outputPerM() != null ? c.outputPerM() : m.getOutputPerM();
        var cache = c.cacheReadPerM() != null ? c.cacheReadPerM() : m.getCacheReadPerM();
        change(changes, "inputPerM", m.getInputPerM(), input);
        change(changes, "outputPerM", m.getOutputPerM(), output);
        change(changes, "cacheReadPerM", m.getCacheReadPerM(), cache);
        boolean pricesChanged = !changes.isEmpty();
        if (c.contextWindow() != null) change(changes, "contextWindow", m.getContextWindow(), c.contextWindow());
        if (c.maxOutputTokens() != null) change(changes, "maxOutputTokens", m.getMaxOutputTokens(), c.maxOutputTokens());
        if (c.name() != null && !m.isDisplayNameManual()) change(changes, "displayName", m.getDisplayName(), c.name());
        if (c.creator() != null) change(changes, "provider", m.getProvider(), c.creator());
        if (pricesChanged || m.getPriceSource() == null) {
            m.setPrices(input, output, cache, m.getBatchDiscount(), now);
        }
        if (c.contextWindow() != null) m.setContextWindow(c.contextWindow());
        if (c.maxOutputTokens() != null) m.setMaxOutputTokens(c.maxOutputTokens());
        if (c.name() != null && !m.isDisplayNameManual()) m.setDisplayName(c.name());
        if (c.creator() != null) m.setProvider(c.creator());
        m.setPriceSource("do-catalog");
        // Hints, never over a probe's verdict.
        if (c.has("reasoning") && !m.isSupportsReasoningEffort() && m.getLastProbe() == null) {
            m.setSupportsReasoningEffort(true);
            changes.add(new KbModelSyncResponse.Change("supportsReasoningEffort", "false", "true"));
        }
        if (c.has("tool_calling") && "unknown".equals(m.getToolCalling())) {
            m.setToolCalling("yes");
            changes.add(new KbModelSyncResponse.Change("toolCalling", "unknown", "yes"));
        }
        for (var ch : changes) {
            priceHistory.save(new org.ceitba.api.domain.kb.KbModelPriceHistory(m.getId(), ch.field(), ch.old(),
                ch.newValue(), now, source));
        }
        return changes;
    }

    private static void change(List<KbModelSyncResponse.Change> out, String field, Object old, Object now) {
        String o = str(old);
        String n = str(now);
        if (java.util.Objects.equals(o, n)) return;
        out.add(new KbModelSyncResponse.Change(field, o, n));
    }

    private static String str(Object v) {
        if (v == null) return null;
        if (v instanceof BigDecimal b) return b.stripTrailingZeros().toPlainString();
        return v.toString();
    }

    // Fallback: ids from the inference /v1/models (no prices), added disabled.
    private KbModelSyncResponse syncIds() {
        if (!chat.available()) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Neither DO's model catalog nor inference (KB_LLM_API_KEY) is available");
        }
        var ids = chat.listModels();
        var now = OffsetDateTime.now(clock);
        return tx.execute(s -> {
            var known = new HashSet<String>();
            models.findAll().forEach(m -> known.add(m.getId()));
            var added = new ArrayList<String>();
            for (var id : ids) {
                if (known.contains(id) || id.length() > 128) continue;
                if (!KbEndpointRegistry.SAFE_ID.matcher(id).matches()) {
                    log.warn("KB catalog: skipping DO model id with characters that break the /models/{id} routes: {}", id);
                    continue;
                }
                var m = new KbModel(id, id, provider(id), KbChatPayloads.batchByRule(id), false);
                m.setSupportsReasoningEffort(id.startsWith("glm"));
                models.save(m);
                added.add(id);
            }
            var listed = new HashSet<>(ids);
            var notListed = known.stream().filter(id -> !listed.contains(id)).sorted().toList();
            return new KbModelSyncResponse(List.of(), added, known.size() - notListed.size(), notListed,
                "inference-models", now);
        });
    }

    // One tiny structured-output request through the model's mode (or the
    // given one: batch | sync).
    // Batch probes (ADMIN doc §6) send the JSONL with the model's batch id
    // (batchModelId, else the catalog id without its provider prefix). DO
    // answers asynchronously, so the probe stays pending until the poller
    // sees the batch finished; at most one pending batch probe per model (a
    // second call returns the pending one). If DO says the model id is
    // unsupported, the probe retries once with the other form (native <->
    // prefixed) and stores whichever works in batchModelId; batchSupported
    // turns false only when both forms are unsupported. A rate-limited (429)
    // or unanswered creation is retried on the poller (1, 5, 15, 60 min).
    // Any other error is a failed probe that leaves batchSupported alone.
    public KbModelResponse probe(String id, String modeOverride) {
        var model = tx.execute(s -> models.findById(id).orElseThrow(() -> new ResourceNotFoundException("KbModel", id)));
        String mode;
        if (modeOverride == null || modeOverride.isBlank()) {
            mode = router.modeFor(id, settings.effective().executionMode());
        } else {
            mode = modeOverride.trim().toUpperCase(Locale.ROOT);
            if (!mode.equals("BATCH") && !mode.equals("SYNC")) throw new ValidationException("mode", modeOverride, "must be batch or sync");
            if (mode.equals("BATCH") && KbChatPayloads.batchProvider(id) == null) {
                throw new ValidationException("mode", modeOverride, "DO batches only take anthropic-*/openai-* models");
            }
        }
        if (!router.available(id, mode)) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Inference is not configured (KB_LLM_API_KEY)");
        }
        var started = OffsetDateTime.now(clock);
        if (mode.equals("BATCH")) {
            var current = model.probeIn("batch");
            if (current != null && current.path("pending").asBoolean(false)) {
                log.info("KB catalog: batch probe of {} already pending; not submitting another", id);
                return tx.execute(s -> view(models.findById(id).orElseThrow()));
            }
            var first = model.getBatchModelId() != null ? model.getBatchModelId()
                : KbChatPayloads.defaultBatchModelId(id);
            return saveBatchProbe(id, submitBatchProbe(id, first, List.of(), started, 0), null);
        }
        var line = probeLine(id);
        ObjectNode probe = json.createObjectNode();
        probe.put("mode", "sync");
        probe.put("at", started.toString());
        var res = sync.runOne(line);
        fill(probe, res, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
        recordUsage(id, mode, res);
        return tx.execute(s -> {
            var m = models.findById(model.getId()).orElseThrow();
            m.setLastProbe(mergeProbe(m.getLastProbe(), probe));
            updateToolCalling(m, probe);
            return view(m);
        });
    }

    private LlmLine probeLine(String id) {
        var params = payloads.tuned(id, "DIGEST", 4000, "low", null,
            "Archivo: prueba.txt (parte 1/1)\n\nEl interés compuesto capitaliza los intereses de cada período: "
                + "M = C (1 + i)^n.");
        return new LlmLine("probe-" + Math.abs(id.hashCode()), params);
    }

    // Submits one batch probe of `id` with `batchModelId` in the JSONL.
    // tried: the forms DO already refused as unsupported; retries: refused
    // creations so far (back-off). The result is the probe entry to store:
    // pending {batchId} or {retryAt}, or finished (ok false).
    ObjectNode submitBatchProbe(String id, String batchModelId, List<String> tried, OffsetDateTime started,
                                int retries) {
        return submitBatchProbe(id, batchModelId, tried, json.createObjectNode(), started, retries);
    }

    // triedErrors: DO's error per refused form ({"gpt-6-luna": "..."}), kept
    // so the admin panel can show why batch is not available.
    ObjectNode submitBatchProbe(String id, String batchModelId, List<String> tried, JsonNode triedErrors,
                                OffsetDateTime started, int retries) {
        var probe = json.createObjectNode();
        if (triedErrors != null && triedErrors.size() > 0) probe.set("triedErrors", triedErrors.deepCopy());
        probe.put("mode", "batch");
        probe.put("at", started.toString());
        probe.put("batchModelId", batchModelId);
        var triedNode = probe.putArray("tried");
        tried.forEach(triedNode::add);
        var now = OffsetDateTime.now(clock);
        try {
            var submitted = batch.submit("kb-probe-" + id, id, batchModelId, List.of(probeLine(id)),
                "kb-probe-" + id + "-" + now.toEpochSecond());
            probe.put("ok", false);
            probe.put("pending", true);
            probe.put("batchId", submitted.batchId());
            noAnswer(probe, Duration.between(started, now).toMillis());
            return probe;
        } catch (org.ceitba.api.external.llm.LlmApiException e) {
            var kind = DoBatchErrors.classify(e.status(), e.getMessage());
            probe.put("ok", false);
            noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
            switch (kind) {
                case RATE_LIMITED, TRANSIENT -> {
                    var slot = e instanceof org.ceitba.api.external.llm.DoBatchSlotException x ? x : null;
                    var hourly = String.valueOf(e.getMessage()).contains("batch_creations_per_hour");
                    var at = slot != null ? slot.retryAt()
                        : now.plus(hourly ? java.time.Duration.ofMinutes(60) : KbBatchSubmitter.backoff(retries + 1));
                    probe.put("pending", true);
                    probe.put("retryAt", at.toString());
                    probe.put("retries", retries + 1);
                    probe.put("error", slot != null ? slot.getMessage().replace(" (rate_limit_exceeded)", "")
                        + "; reintento a las " + at.atZoneSameInstant(org.ceitba.api.config.ClockConfig.ZONE).toLocalTime()
                            .truncatedTo(java.time.temporal.ChronoUnit.MINUTES) : (kind == DoBatchErrors.Kind.RATE_LIMITED
                        ? "DigitalOcean limitó la creación de lotes; reintento a las "
                        : "DigitalOcean no respondió al crear el lote; reintento a las ")
                        + at.atZoneSameInstant(org.ceitba.api.config.ClockConfig.ZONE).toLocalTime()
                            .truncatedTo(java.time.temporal.ChronoUnit.MINUTES) + " (" + e.getMessage() + ")");
                    log.warn("KB catalog: batch probe of {} refused ({}); retry at {}", id, e.getMessage(), at);
                    return probe;
                }
                case UNSUPPORTED_MODEL -> {
                    return unsupported(id, batchModelId, tried, started, e.getMessage(), probe);
                }
                default -> {
                    probe.put("error", "batch rejected: " + e.getMessage());
                    return probe;
                }
            }
        }
    }

    // DO refused `batchModelId` as unsupported: the other form if untried,
    // else a finished probe marked unsupportedModel (batchSupported false).
    private ObjectNode unsupported(String id, String batchModelId, List<String> tried, OffsetDateTime started,
                                   String error, ObjectNode probe) {
        var triedNow = new ArrayList<>(tried);
        if (!triedNow.contains(batchModelId)) triedNow.add(batchModelId);
        var errors = probe.has("triedErrors") ? (ObjectNode) probe.get("triedErrors") : probe.putObject("triedErrors");
        errors.put(batchModelId, error);
        var other = KbChatPayloads.otherBatchModelId(id, batchModelId);
        if (other != null && !triedNow.contains(other)) {
            log.info("KB catalog: batch probe of {}: {} unsupported ({}), retrying with {}", id, batchModelId, error,
                other);
            return submitBatchProbe(id, other, triedNow, errors, started, 0);
        }
        var triedNode = probe.putArray("tried");
        triedNow.forEach(triedNode::add);
        probe.remove("pending");
        probe.put("ok", false);
        probe.put("unsupportedModel", true);
        // DO's own words per id form, e.g. "gpt-6-luna: OpenAI Batch is not available; openai-gpt-6-luna: ...".
        var sb = new StringBuilder("batch not available for this model on DigitalOcean: ");
        var it = errors.fields();
        while (it.hasNext()) {
            var e = it.next();
            sb.append(e.getKey()).append(": ").append(e.getValue().asText());
            if (it.hasNext()) sb.append("; ");
        }
        probe.put("error", sb.toString());
        return probe;
    }

    // Stores a batch probe entry: unsupportedModel (every id form refused)
    // sets batchSupported false; a successful one sets it true and keeps the
    // id that worked in batchModelId.
    private KbModelResponse saveBatchProbe(String id, ObjectNode probe, Boolean worked) {
        return tx.execute(s -> {
            var m = models.findById(id).orElseThrow();
            m.setLastProbe(mergeProbe(m.getLastProbe(), probe));
            updateToolCalling(m, probe);
            var now = OffsetDateTime.now(clock);
            if (Boolean.TRUE.equals(worked)) {
                m.setBatchFromProbe(true, now);
                var used = probe.path("batchModelId").asText(null);
                if (used != null) m.setBatchModelId(used);
            } else if (probe.path("unsupportedModel").asBoolean(false)) {
                m.setBatchFromProbe(false, now);
            }
            return view(m);
        });
    }

    // Finishes BATCH probes whose batch is done, and resubmits the ones whose
    // creation was refused once their retryAt is due (called by KbPipelineJob).
    public void refreshPendingProbes() {
        var pending = tx.execute(s -> models.findAll().stream()
            .filter(m -> m.probeIn("batch") != null && m.probeIn("batch").path("pending").asBoolean(false))
            .map(KbModel::getId).toList());
        for (var id : pending) {
            try {
                refreshProbe(id);
            } catch (RuntimeException e) {
                log.warn("KB catalog: probe of {} not refreshed: {}", id, e.getMessage());
            }
        }
    }

    private void refreshProbe(String id) {
        var m = tx.execute(s -> models.findById(id).orElseThrow());
        var p = m.probeIn("batch");
        var started = OffsetDateTime.parse(p.path("at").asText());
        var batchModelId = p.path("batchModelId").asText(null);
        if (batchModelId == null) batchModelId = KbChatPayloads.defaultBatchModelId(id);
        var tried = new ArrayList<String>();
        p.path("tried").forEach(t -> tried.add(t.asText()));
        if (!p.hasNonNull("batchId")) {
            // A refused creation, retried when due.
            var retryAt = p.hasNonNull("retryAt") ? OffsetDateTime.parse(p.path("retryAt").asText()) : null;
            if (retryAt != null && OffsetDateTime.now(clock).isBefore(retryAt)) return;
            saveBatchProbe(id, submitBatchProbe(id, batchModelId, tried, p.path("triedErrors"), started,
                p.path("retries").asInt(0)), null);
            return;
        }
        var batchId = p.path("batchId").asText();
        var info = batch.poll(batchId);
        if (!info.finished()) return;
        var probe = json.createObjectNode();
        probe.put("mode", "batch");
        probe.put("at", started.toString());
        probe.put("batchId", batchId);
        probe.put("batchModelId", batchModelId);
        var triedNode = probe.putArray("tried");
        tried.forEach(triedNode::add);
        if (p.path("triedErrors").size() > 0) probe.set("triedErrors", p.path("triedErrors").deepCopy());
        if (info.status().equals("failed") && info.errorMessage() != null
            && DoBatchErrors.classifyFailure(info.errorMessage()) == DoBatchErrors.Kind.UNSUPPORTED_MODEL) {
            noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
            saveBatchProbe(id, unsupported(id, batchModelId, tried, started, info.errorMessage(), probe), null);
            return;
        }
        var collected = batch.collect(batchId, info.status().equals("completed"));
        var res = collected.results().values().stream().findFirst().orElse(null);
        if (res == null) {
            probe.put("ok", false);
            probe.put("error", "batch " + info.status() + (info.errorMessage() == null ? " without results"
                : ": " + info.errorMessage()));
            noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
        } else {
            fill(probe, res, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
            recordUsage(id, "BATCH", res);
        }
        saveBatchProbe(id, probe, res != null && res.ok());
        log.info("KB catalog: batch probe of {} with {}: {}", id, batchModelId,
            res != null && res.ok() ? "ok" : probe.path("error").asText());
        // The exact output line, so the provider's shape can be checked.
        if (collected.output() != null) {
            var raw = new String(collected.output(), java.nio.charset.StandardCharsets.UTF_8);
            log.info("KB catalog: batch probe of {} output ({} bytes) first line: {}", id, raw.length(),
                raw.lines().findFirst().map(l -> l.length() > 2000 ? l.substring(0, 2000) : l).orElse(""));
        }
    }

    // A batch probe error that says the model or provider has no batch
    // support (a 4xx whose code or message says so). Everything else (bad
    // file name, account blocked, rate limit, 5xx) is just a failed probe.
    public static boolean batchUnsupported(int status, String message) {
        if (status < 400 || status >= 500 || status == 429) return false;
        return DoBatchErrors.unsupportedModel(message);
    }

    // lastProbe keeps one entry per mode (sync, batch); its top level is the
    // most recent probe (ADMIN doc §6 shape) for compatibility.
    static ObjectNode mergeProbe(JsonNode previous, ObjectNode probe) {
        var out = probe.deepCopy();
        out.remove("sync");
        out.remove("batch");
        for (var mode : List.of("sync", "batch")) {
            JsonNode entry = null;
            if (previous != null) {
                if (previous.has(mode) && previous.get(mode).isObject()) entry = previous.get(mode);
                else if (!previous.has("sync") && !previous.has("batch") && mode.equals(previous.path("mode").asText(""))) {
                    entry = previous;   // stored before per-mode probes
                }
            }
            if (mode.equals(probe.path("mode").asText())) entry = probe;
            if (entry != null) {
                var copy = entry.deepCopy();
                if (copy instanceof ObjectNode o) {
                    o.remove("sync");
                    o.remove("batch");
                }
                out.set(mode, copy);
            }
        }
        return out;
    }

    // lastProbe always carries the ADMIN doc §6 fields: without an answer,
    // toolCalling "no", the elapsed latency and zero usage.
    private void noAnswer(ObjectNode probe, long latencyMs) {
        probe.put("toolCalling", "no");
        probe.put("latencyMs", latencyMs);
        var u = probe.putObject("usage");
        u.put("inputTokens", 0);
        u.put("cachedInputTokens", 0);
        u.put("outputTokens", 0);
    }

    private void fill(ObjectNode probe, LlmOutputParser.LlmResult res, long latencyMs) {
        boolean structured = res.ok() && res.toolInput() != null && res.toolInput().has("topics");
        probe.put("ok", structured);
        probe.put("toolCalling", "tool".equals(res.path()) ? "yes" : "no");
        probe.put("path", res.path());
        probe.put("latencyMs", latencyMs);
        var u = probe.putObject("usage");
        u.put("inputTokens", res.tokensIn());
        u.put("cachedInputTokens", res.cachedTokens());
        u.put("outputTokens", res.tokensOut());
        if (res.error() != null) probe.put("error", res.error());
        else if (!structured) probe.put("error", "no structured answer (path " + res.path() + ")");
    }

    private void recordUsage(String model, String mode, LlmOutputParser.LlmResult res) {
        if (res.tokensIn() == 0 && res.tokensOut() == 0) return;
        tx.executeWithoutResult(s -> usage.record(null, null, null, model, mode, "PROBE", null, res.tokensIn(),
            res.cachedTokens(), res.tokensOut()));
    }

    private static void updateToolCalling(KbModel m, JsonNode probe) {
        if (probe.path("pending").asBoolean(false)) return;
        if (probe.path("toolCalling").asText("").equals("yes")) m.setToolCalling("yes");
        else if (probe.path("ok").asBoolean(false)) m.setToolCalling("no");
    }

    private void apply(KbModel m, JsonNode b) {
        if (b.hasNonNull("displayName")) {
            m.setDisplayName(b.get("displayName").asText());
            m.setDisplayNameManual(true);   // a catalog sync keeps it
        }
        if (b.hasNonNull("provider")) m.setProvider(b.get("provider").asText());
        if (b.hasNonNull("batchSupported")) m.setBatchSupported(b.get("batchSupported").asBoolean());
        if (b.has("batchModelId")) {
            var v = b.get("batchModelId").isNull() ? null : b.get("batchModelId").asText().trim();
            if (v != null && v.length() > 128) throw new ValidationException("batchModelId", v, "max 128 chars");
            m.setBatchModelId(v);   // null/blank = the default (catalog id without its provider prefix)
        }
        if (b.hasNonNull("batchDiscountVerified")) m.setBatchDiscountVerified(b.get("batchDiscountVerified").asBoolean());
        if (b.hasNonNull("enabled")) m.setEnabled(b.get("enabled").asBoolean());
        if (b.hasNonNull("supportsReasoningEffort")) m.setSupportsReasoningEffort(b.get("supportsReasoningEffort").asBoolean());
        if (b.hasNonNull("toolCalling")) {
            var t = b.get("toolCalling").asText().toLowerCase(Locale.ROOT);
            if (!TOOL_CALLING.contains(t)) throw new ValidationException("toolCalling", t, "must be unknown, yes or no");
            m.setToolCalling(t);
        }
        if (b.has("contextWindow")) m.setContextWindow(b.get("contextWindow").isNull() ? null : b.get("contextWindow").asInt());
        if (b.has("notes")) m.setNotes(b.get("notes").isNull() ? null : b.get("notes").asText());
        boolean prices = b.has("inputPerM") || b.has("outputPerM") || b.has("cacheReadPerM") || b.has("batchDiscount");
        if (prices) {
            var input = price(b, "inputPerM", m.getInputPerM());
            var output = price(b, "outputPerM", m.getOutputPerM());
            var cache = price(b, "cacheReadPerM", m.getCacheReadPerM());
            var discount = price(b, "batchDiscount", m.getBatchDiscount());
            if (discount != null && (discount.signum() < 0 || discount.compareTo(BigDecimal.ONE) > 0)) {
                throw new ValidationException("batchDiscount", discount, "must be between 0 and 1");
            }
            var now = OffsetDateTime.now(clock);
            var changes = new ArrayList<KbModelSyncResponse.Change>();
            change(changes, "inputPerM", m.getInputPerM(), input);
            change(changes, "outputPerM", m.getOutputPerM(), output);
            change(changes, "cacheReadPerM", m.getCacheReadPerM(), cache);
            change(changes, "batchDiscount", m.getBatchDiscount(), discount);
            for (var ch : changes) {
                priceHistory.save(new org.ceitba.api.domain.kb.KbModelPriceHistory(m.getId(), ch.field(), ch.old(),
                    ch.newValue(), now, "manual"));
            }
            m.setPrices(input, output, cache, discount, now);
            if (b.has("inputPerM") || b.has("outputPerM") || b.has("cacheReadPerM")) m.setPriceSource("manual");
        }
    }

    private static BigDecimal price(JsonNode b, String field, BigDecimal current) {
        if (!b.has(field)) return current;
        if (b.get(field).isNull()) return null;
        if (!b.get(field).isNumber()) throw new ValidationException(field, b.get(field), "must be a number");
        var v = b.get(field).decimalValue();
        if (v.signum() < 0) throw new ValidationException(field, v, "must be >= 0");
        return v;
    }

    static String provider(String id) {
        var p = KbChatPayloads.batchProvider(id);
        if (p != null) return p;
        if (id.startsWith(KbEndpointRegistry.PREFIX)) return "custom";
        if (id.startsWith("glm")) return "zhipu";
        if (id.startsWith("deepseek")) return "deepseek";
        return "do";
    }

    KbModelResponse view(KbModel m) {
        return view(m, null);
    }

    KbModelResponse view(KbModel m, Double emptyToolCallRate) {
        var sync = KbPricing.effective(m, "SYNC");
        var batchPrices = m.isBatchSupported() ? KbPricing.effective(m, "BATCH") : null;
        var effective = new KbModelResponse.EffectivePrices(
            batchPrices == null ? null : new KbModelResponse.Price(batchPrices.inputPerM(), batchPrices.outputPerM(),
                batchPrices.cacheReadPerM()),
            new KbModelResponse.Price(sync.inputPerM(), sync.outputPerM(), sync.cacheReadPerM()));
        return new KbModelResponse(m.getId(), m.getDisplayName(), m.getProvider(), m.isBatchSupported(),
            m.getBatchSource(), m.getBatchVerifiedAt(), m.isBatchDiscountVerified(), m.getToolCalling(),
            m.isSupportsReasoningEffort(), m.isEnabled(), m.getInputPerM(), m.getOutputPerM(), m.getCacheReadPerM(),
            m.getBatchDiscount(), effective, m.getContextWindow(), m.getMaxOutputTokens(), m.getNotes(),
            m.getPricesUpdatedAt(), m.getPriceSource(),
            m.getLastProbe(), m.selectableIn(m.modeFor(settings.effective().executionMode())), emptyToolCallRate,
            m.getBatchModelId(), KbChatPayloads.batchProvider(m.getId()) == null ? null
                : m.getBatchModelId() != null ? m.getBatchModelId() : KbChatPayloads.defaultBatchModelId(m.getId()),
            m.getRemoteModelId());
    }
}
