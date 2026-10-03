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

    public KbModelCatalogService(KbModelRepository models,
                                 org.ceitba.api.repository.kb.KbRunRequestRepository requests, KbSettingsService settings, KbLlmRouter router,
                                 SyncLlmExecutor sync, BatchLlmExecutor batch, SyncChatClient chat,
                                 KbPayloads payloads, KbUsageRecorder usage, TransactionTemplate tx,
                                 ObjectMapper json, Clock clock) {
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
    public KbModelSyncResponse sync() {
        if (!chat.available()) {
            throw new KbPipelineException(KbPipelineException.Reason.LLM_UNCONFIGURED,
                "Inference is not configured (KB_LLM_API_KEY)");
        }
        var ids = chat.listModels();
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
            return new KbModelSyncResponse(added, ids.size());
        });
    }

    // One tiny structured-output request through the model's mode (or the
    // given one: batch | sync). A batch probe decides batchSupported: a
    // successful one sets it true, a rejected submission false (batchSource probe).
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
            } catch (org.ceitba.api.external.llm.LlmApiException e) {
                if (e.status() == 0 || e.status() >= 500 || e.status() == 429) throw e;
                probe.put("ok", false);
                probe.put("error", "batch rejected: " + e.getMessage());
                batchRejected = true;
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
                    else if (info.status().equals("failed")) mm.setBatchFromProbe(false, OffsetDateTime.now(clock));
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
        if (b.hasNonNull("displayName")) m.setDisplayName(b.get("displayName").asText());
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
            m.setPrices(input, output, cache, discount, OffsetDateTime.now(clock));
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
            m.getBatchDiscount(), effective, m.getContextWindow(), m.getNotes(), m.getPricesUpdatedAt(),
            m.getLastProbe(), m.isEnabled() && m.probeSucceeded(), emptyToolCallRate);
    }
}
