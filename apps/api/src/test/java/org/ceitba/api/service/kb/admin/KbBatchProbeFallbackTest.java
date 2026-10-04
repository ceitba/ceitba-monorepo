package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.domain.kb.KbLlmUsage;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.service.kb.InMemoryRepo;
import org.ceitba.api.service.kb.NoTx;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbUsageRecorder;
import org.ceitba.api.service.kb.pipeline.KbPayloads;
import org.ceitba.api.web.kb.admin.KbModelResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

// Batch probe: batch model id forms (native <-> prefixed), when
// batchSupported changes, one pending probe per model, 429 retry later.
class KbBatchProbeFallbackTest {

    static final String LUNA = "openai-gpt-6-luna";

    final ObjectMapper json = new ObjectMapper();
    final FakeLlmBatchClient fake = new FakeLlmBatchClient(json);
    Instant now = Instant.parse("2026-10-03T06:30:00Z");
    final Clock clock = new Clock() {
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    };
    InMemoryRepo<KbModel, String> models;
    KbModelCatalogService catalog;

    @BeforeEach
    void setUp() {
        models = new InMemoryRepo<>(KbModel::getId);
        models.rows.put(LUNA, new KbModel(LUNA, "GPT-6 Luna", "openai", true, true));
        var modelRepo = models.as(KbModelRepository.class);
        var router = new KbLlmRouter(fake, new FakeSyncChatClient(json), new KbLlmProperties(null, null, "auto", 4, true),
            modelRepo);
        var usage = new KbUsageRecorder(new InMemoryRepo<KbLlmUsage, Object>(u -> new Object())
            .as(KbLlmUsageRepository.class), modelRepo, router, clock);
        catalog = new KbModelCatalogService(modelRepo, null, null, router, null, new BatchLlmExecutor(fake, json), null,
            new KbPayloads(json, modelRepo), usage, NoTx.template(), json, clock, null, null) {
            @Override
            KbModelResponse view(KbModel m) {
                return null;   // the response needs the settings; the test reads the model
            }
        };
        fake.respond(r -> json.createObjectNode().set("topics", json.createArrayNode().add("interés compuesto")));
    }

    KbModel luna() {
        return models.rows.get(LUNA);
    }

    @Test
    void nativeIdRefusedThenPrefixedIdWorksAndIsStored() {
        fake.unsupportedModels(id -> id.equals("gpt-6-luna"));
        catalog.probe(LUNA, "batch");
        assertThat(luna().probeIn("batch").path("batchModelId").asText()).isEqualTo("gpt-6-luna");
        assertThat(luna().probeIn("batch").path("pending").asBoolean()).isTrue();

        catalog.refreshPendingProbes();   // validation failed: retried with the other form
        assertThat(luna().probeIn("batch").path("batchModelId").asText()).isEqualTo(LUNA);
        assertThat(luna().probeIn("batch").path("pending").asBoolean()).isTrue();
        assertThat(luna().isBatchSupported()).isTrue();

        catalog.refreshPendingProbes();
        assertThat(luna().probeIn("batch").path("ok").asBoolean()).isTrue();
        assertThat(luna().getBatchModelId()).isEqualTo(LUNA);
        assertThat(luna().isBatchSupported()).isTrue();
        assertThat(luna().getBatchSource()).isEqualTo("probe");
        assertThat(fake.createCalls()).isEqualTo(2);
    }

    @Test
    void nativeIdWorksFirst() {
        catalog.probe(LUNA, "batch");
        catalog.refreshPendingProbes();
        assertThat(luna().probeIn("batch").path("ok").asBoolean()).isTrue();
        assertThat(luna().getBatchModelId()).isEqualTo("gpt-6-luna");
        assertThat(fake.submitted()).extracting(r -> r.model()).containsExactly("gpt-6-luna");
    }

    @Test
    void bothFormsUnsupportedTurnBatchOff() {
        fake.unsupportedModels(id -> true);
        catalog.probe(LUNA, "batch");
        catalog.refreshPendingProbes();
        assertThat(luna().isBatchSupported()).isTrue();   // one form left to try
        catalog.refreshPendingProbes();
        var p = luna().probeIn("batch");
        assertThat(p.path("ok").asBoolean()).isFalse();
        assertThat(p.path("pending").asBoolean(false)).isFalse();
        assertThat(p.path("unsupportedModel").asBoolean()).isTrue();
        assertThat(p.path("error").asText()).contains("unsupported model");
        assertThat(luna().isBatchSupported()).isFalse();
        assertThat(luna().getBatchModelId()).isNull();
    }

    @Test
    void otherErrorsLeaveBatchSupportedAlone() {
        fake.failNextCreate(new LlmApiException(400, "POST /v1/batches -> 400: invalid completion_window"));
        catalog.probe(LUNA, "batch");
        var p = luna().probeIn("batch");
        assertThat(p.path("ok").asBoolean()).isFalse();
        assertThat(p.path("pending").asBoolean(false)).isFalse();
        assertThat(luna().isBatchSupported()).isTrue();
        assertThat(luna().getBatchSource()).isEqualTo("rule");
    }

    @Test
    void rateLimitedProbeIsRetriedLaterAndOnlyOneIsPending() {
        fake.failNextCreate(new LlmApiException(429, "POST /v1/batches -> 429: {\"error\":{\"message\":\"Rate limit "
            + "exceeded: batch_create_per_minute, batch_creations_per_hour.\",\"type\":\"rate_limit_exceeded_error\"}}"));
        catalog.probe(LUNA, "batch");
        var p = luna().probeIn("batch");
        assertThat(p.path("pending").asBoolean()).isTrue();
        // batch_creations_per_hour: a refused attempt counts too, so a full hour.
        assertThat(p.path("retryAt").asText()).isEqualTo("2026-10-03T07:30Z");
        assertThat(p.path("error").asText()).startsWith("DigitalOcean limitó la creación de lotes; reintento a las 04:30");
        assertThat(luna().isBatchSupported()).isTrue();

        catalog.probe(LUNA, "batch");          // already pending: not submitted again
        catalog.refreshPendingProbes();        // not due yet
        assertThat(fake.createCalls()).isEqualTo(1);

        now = now.plusSeconds(3600);
        catalog.refreshPendingProbes();        // due: submitted
        assertThat(fake.createCalls()).isEqualTo(2);
        assertThat(luna().probeIn("batch").hasNonNull("batchId")).isTrue();
        catalog.refreshPendingProbes();
        assertThat(luna().probeIn("batch").path("ok").asBoolean()).isTrue();
    }
}
