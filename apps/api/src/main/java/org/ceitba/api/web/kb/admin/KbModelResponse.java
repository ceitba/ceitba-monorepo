package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

// A catalog model. Prices: USD per million tokens (list); effectivePrices:
// what a stage pays in each mode (batch = list x (1 - batchDiscount));
// batchSource: rule | probe; batchDiscountVerified: false = DO's advertised
// "up to 50%" (an estimate) until calibrated with PUT {batchDiscount, batchDiscountVerified: true}. toolCalling: unknown | yes |
// no. lastProbe (ADMIN doc §6): {ok, mode: batch|sync, toolCalling: yes|no,
// latencyMs, usage: {inputTokens, cachedInputTokens, outputTokens}, error?, at}
// plus path (tool | content-json | json_object | text) and, while a batch
// probe waits, {pending: true, batchId} or {pending: true, retryAt, retries}
// (creation rate-limited); batch probes also carry batchModelId and tried
// (ids DO refused as unsupported) and unsupportedModel: true when every id
// form was refused.
// selectable: enabled and probed successfully (required by PUT /settings).
// emptyToolCallRate: share of its last 200 structured requests whose answer
// was empty/unparseable or cut by max_tokens (null without requests).
// batchModelId: the model id batch JSONL lines use, as stored (editable with
// PUT; null = default); effectiveBatchModelId: what a batch sends (stored,
// else the catalog id without its openai-/anthropic- prefix; null for models
// without a batch provider). Sync requests always use `id`.
// remoteModelId: custom endpoint models only: the raw id the endpoint knows (the
// catalog id is custom:<endpoint>:<slug>, slash-free); null otherwise.
public record KbModelResponse(
    String id,
    String displayName,
    String provider,
    boolean batchSupported,
    String batchSource,
    OffsetDateTime batchVerifiedAt,
    boolean batchDiscountVerified,
    String toolCalling,
    boolean supportsReasoningEffort,
    boolean enabled,
    BigDecimal inputPerM,
    BigDecimal outputPerM,
    BigDecimal cacheReadPerM,
    BigDecimal batchDiscount,
    EffectivePrices effectivePrices,
    Integer contextWindow,
    Integer maxOutputTokens,
    String notes,
    OffsetDateTime pricesUpdatedAt,
    String priceSource,
    JsonNode lastProbe,
    boolean selectable,
    Double emptyToolCallRate,
    String batchModelId,
    String effectiveBatchModelId,
    String remoteModelId
) {
    // batch: null when the model has no batch support.
    public record EffectivePrices(Price batch, Price sync) {}

    public record Price(BigDecimal inputPerM, BigDecimal outputPerM, BigDecimal cacheReadPerM) {}
}
