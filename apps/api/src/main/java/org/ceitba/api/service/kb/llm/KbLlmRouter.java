package org.ceitba.api.service.kb.llm;

import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.SyncChatClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Locale;

// Execution mode per model: BATCH (DO batch API; only anthropic-*/openai-*
// commercial models) or SYNC (chat completions one by one).
//   auto  -> BATCH when the model supports it, else SYNC
//   batch -> BATCH; a model without batch support falls back to SYNC
//            (the settings reject that combination; this covers env typos)
//   sync  -> SYNC
@Component
public class KbLlmRouter {

    private static final Logger log = LoggerFactory.getLogger(KbLlmRouter.class);

    private final LlmBatchClient batch;
    private final SyncChatClient sync;
    private final KbLlmProperties props;
    private final org.ceitba.api.repository.kb.KbModelRepository models;

    public KbLlmRouter(LlmBatchClient batch, SyncChatClient sync, KbLlmProperties props,
                       org.ceitba.api.repository.kb.KbModelRepository models) {
        this.batch = batch;
        this.sync = sync;
        this.props = props;
        this.models = models;
    }

    // Catalog batchSupported (rule or probe), else the rule.
    public boolean batchSupported(String model) {
        if (KbChatPayloads.batchProvider(model) == null) return false;   // DO batches take only these providers
        return models.findById(model).map(org.ceitba.api.domain.kb.KbModel::isBatchSupported)
            .orElseGet(() -> KbChatPayloads.batchByRule(model));
    }

    // The model id batch JSONL lines carry: the catalog's batchModelId, else
    // the catalog id without its openai-/anthropic- prefix. Sync requests
    // keep the catalog id.
    public String batchModelId(String model) {
        return models.findById(model).map(org.ceitba.api.domain.kb.KbModel::getBatchModelId)
            .orElseGet(() -> KbChatPayloads.defaultBatchModelId(model));
    }

    public String modeFor(String model, String executionMode) {
        var mode = executionMode == null ? props.executionMode() : executionMode.toLowerCase(Locale.ROOT);
        boolean batchCapable = batchSupported(model);
        return switch (mode) {
            case "sync" -> "SYNC";
            case "batch" -> {
                if (!batchCapable) log.warn("KB pipeline: {} has no batch support; using sync", model);
                yield batchCapable ? "BATCH" : "SYNC";
            }
            default -> batchCapable ? "BATCH" : "SYNC";
        };
    }

    public boolean available() {
        return batch.available() && sync.available();
    }

    // Custom models (custom:<endpoint>:<slug>) only ever run sync, on their own
    // endpoint: no DO key needed.
    // Inference can start when every model is custom (own endpoint, no DO key)
    // or, if any is a DO model, the DO key is configured.
    public boolean availableFor(java.util.Collection<String> models) {
        boolean needsDo = models.stream().anyMatch(m -> m != null && !m.isBlank() && !KbEndpointRegistry.isCustom(m));
        return !needsDo || available();
    }

    public boolean available(String model, String mode) {
        if (KbEndpointRegistry.isCustom(model)) return true;
        return available(mode);
    }

    public boolean available(String mode) {
        return "BATCH".equals(mode) ? batch.available() : sync.available();
    }

    // Results come from the fake executors (KB_LLM_USE_FAKE): recorded as simulated.
    public boolean simulated() {
        return props.useFake() || batch instanceof FakeLlmBatchClient;
    }
}
