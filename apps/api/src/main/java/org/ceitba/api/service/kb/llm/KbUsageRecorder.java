package org.ceitba.api.service.kb.llm;

import org.ceitba.api.domain.kb.KbLlmUsage;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

// Writes one kb_llm_usage row per request result, priced at the catalog
// price of this moment (frozen). Runs in the caller's transaction.
@Component
public class KbUsageRecorder {

    private final KbLlmUsageRepository usage;
    private final KbModelRepository models;
    private final KbLlmRouter router;
    private final Clock clock;

    public KbUsageRecorder(KbLlmUsageRepository usage, KbModelRepository models, KbLlmRouter router, Clock clock) {
        this.usage = usage;
        this.models = models;
        this.router = router;
        this.clock = clock;
    }

    public BigDecimal record(UUID runId, UUID evalId, String requestId, String model, String mode, String stage,
                             String subjectId, int input, int cached, int output) {
        return record(runId, evalId, requestId, model, mode, stage, subjectId, input, cached, output, 1, null, null);
    }

    // One HTTP call: attempt is 1-based per request; latencyMs (sync) and
    // reasoningTokens (when reported) may be null.
    public BigDecimal record(UUID runId, UUID evalId, String requestId, String model, String mode, String stage,
                             String subjectId, int input, int cached, int output, int attempt, Integer latencyMs,
                             Integer reasoningTokens) {
        var cost = KbPricing.cost(models.findById(model).orElse(null), mode, input, cached, output);
        var row = new KbLlmUsage(OffsetDateTime.now(clock), runId, evalId, requestId, model, mode, stage, subjectId,
            input, cached, output, cost, router.simulated());
        row.setCallInfo(attempt, latencyMs, reasoningTokens);
        usage.save(row);
        return cost;
    }
}
