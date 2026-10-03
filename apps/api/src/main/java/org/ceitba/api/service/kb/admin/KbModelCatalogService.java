package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbChatPayloads;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.service.kb.llm.KbUsageRecorder;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
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
    // given one: batch | sync). A batch probe decides batchSupported: a
    // successful one sets it true, a submission rejected as a bad request
    // (400/404/422) false (batchSource probe); account errors change nothing.
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
        if (!router.available(mode)) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Inference is not configured (KB_LLM_API_KEY)");
        }
        var params = payloads.tuned(id, "DIGEST", 4000, "low", null,
            "Archivo: prueba.txt (parte 1/1)\n\nEl interés compuesto capitaliza los intereses de cada período: "
                + "M = C (1 + i)^n.");
        var line = new LlmLine("probe-" + Math.abs(id.hashCode()), params);
        var started = OffsetDateTime.now(clock);
        ObjectNode probe = json.createObjectNode();
        probe.put("mode", mode.toLowerCase(Locale.ROOT));
        probe.put("at", started.toString());
        boolean batchRejected = false;
        if (mode.equals("BATCH")) {
            try {
                var submitted = batch.submit("kb-probe-" + id, id, List.of(line), "kb-probe-" + started.toEpochSecond());
                probe.put("ok", false);
                probe.put("pending", true);
                probe.put("batchId", submitted.batchId());
                noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
            } catch (org.ceitba.api.external.llm.LlmApiException e) {
                if (e.status() == 0 || e.status() >= 500 || e.status() == 429) throw e;
                probe.put("ok", false);
                probe.put("error", "batch rejected: " + e.getMessage());
                noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
                // Only an explicit "model/provider doesn't support batch" decides
                // batchSupported; any other error is a failed probe.
                batchRejected = batchUnsupported(e.status(), e.getMessage());
            }
        } else {
            var res = sync.runOne(line);
            fill(probe, res, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
            recordUsage(id, mode, res);
        }
        var rejected = batchRejected;
        return tx.execute(s -> {
            var m = models.findById(model.getId()).orElseThrow();
            m.setLastProbe(probe);
            updateToolCalling(m, probe);
            if (rejected) m.setBatchFromProbe(false, OffsetDateTime.now(clock));
            return view(m);
        });
    }

    // Finishes BATCH probes whose batch is done (called by KbPipelineJob).
    public void refreshPendingProbes() {
        var pending = tx.execute(s -> models.findAll().stream()
            .filter(m -> m.getLastProbe() != null && m.getLastProbe().path("pending").asBoolean(false))
            .map(KbModel::getId).toList());
        for (var id : pending) {
            try {
                var m = tx.execute(s -> models.findById(id).orElseThrow());
                var batchId = m.getLastProbe().path("batchId").asText();
                var info = batch.poll(batchId);
                if (!info.finished()) continue;
                var collected = batch.collect(batchId, info.status().equals("completed"));
                var res = collected.results().values().stream().findFirst().orElse(null);
                var started = OffsetDateTime.parse(m.getLastProbe().path("at").asText());
                var probe = json.createObjectNode();
                probe.put("mode", "batch");
                probe.put("at", started.toString());
                probe.put("batchId", batchId);
                if (res == null) {
                    probe.put("ok", false);
                    probe.put("error", "batch " + info.status() + " without results");
                    noAnswer(probe, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
                } else {
                    fill(probe, res, Duration.between(started, OffsetDateTime.now(clock)).toMillis());
                    recordUsage(id, "BATCH", res);
                }
                boolean worked = res != null && res.ok();
                tx.executeWithoutResult(s -> {
                    var mm = models.findById(id).orElseThrow();
                    mm.setLastProbe(probe);
                    updateToolCalling(mm, probe);
                    if (worked) mm.setBatchFromProbe(true, OffsetDateTime.now(clock));
                    else if (info.status().equals("failed") && batchUnsupported(400, info.raw()
                        + (collected.errors() == null ? "" : new String(collected.errors(),
                            java.nio.charset.StandardCharsets.UTF_8)))) {
                        mm.setBatchFromProbe(false, OffsetDateTime.now(clock));
                    }
                });
                // The exact output line, so the provider's shape can be checked.
                if (collected.output() != null) {
                    var raw = new String(collected.output(), java.nio.charset.StandardCharsets.UTF_8);
                    log.info("KB catalog: batch probe of {} output ({} bytes) first line: {}", id, raw.length(),
                        raw.lines().findFirst().map(l -> l.length() > 2000 ? l.substring(0, 2000) : l).orElse(""));
                }
            } catch (RuntimeException e) {
                log.warn("KB catalog: probe of {} not refreshed: {}", id, e.getMessage());
            }
        }
    }

    private static final java.util.regex.Pattern UNSUPPORTED = java.util.regex.Pattern.compile(
        "(model|provider)[_ -]?not[_ -]?supported"
            + "|(not|isn't|is not|un)[_ -]?(supported|available)[^.\\n]{0,40}\\bbatch"
            + "|\\bbatch(es|ing)?\\b[^.\\n]{0,60}(not|isn't|is not|un)[_ -]?(supported|available)"
            + "|does not support[^.\\n]{0,40}\\bbatch|doesn't support[^.\\n]{0,40}\\bbatch",
        java.util.regex.Pattern.CASE_INSENSITIVE);

    // A batch probe error that says the model or provider has no batch
    // support (a 4xx whose code or message says so). Everything else (bad
    // file name, account blocked, rate limit, 5xx) is just a failed probe.
    public static boolean batchUnsupported(int status, String message) {
        if (status < 400 || status >= 500 || message == null) return false;
        return UNSUPPORTED.matcher(message).find();
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
        if (id.startsWith("glm")) return "zhipu";
        if (id.startsWith("deepseek")) return "deepseek";
        return "do";
    }

    static KbModelResponse view(KbModel m) {
        return view(m, null);
    }

    static KbModelResponse view(KbModel m, Double emptyToolCallRate) {
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
            m.getLastProbe(), m.isEnabled() && m.probeSucceeded(), emptyToolCallRate);
    }
}
