package org.ceitba.api.service.kb.admin;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// Only an explicit "no batch for this model/provider" decides batchSupported.
class KbBatchProbeClassificationTest {

    @Test
    void explicitUnsupportedErrorsCount() {
        assertThat(KbModelCatalogService.batchUnsupported(400,
            "{\"id\":\"model_not_supported\",\"message\":\"model glm-5.3 is not supported\"}")).isTrue();
        assertThat(KbModelCatalogService.batchUnsupported(400, "provider not supported for batch inference")).isTrue();
        assertThat(KbModelCatalogService.batchUnsupported(422, "Batch inference is not supported for this model")).isTrue();
        assertThat(KbModelCatalogService.batchUnsupported(404, "This model does not support batch requests")).isTrue();
        assertThat(KbModelCatalogService.batchUnsupported(400, "batches are unavailable for model x")).isTrue();
    }

    @Test
    void otherFailuresDoNotDecideBatchSupport() {
        assertThat(KbModelCatalogService.batchUnsupported(400,
            "POST /v1/batches/files -> 400: {\"message\": \"file must have a .jsonl extension\"}")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(402,
            "{\"id\": \"Payment Required\", \"message\": \"This account has been blocked\" }")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(401, "invalid api key")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(429, "rate limited")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(500, "model not supported")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(400, "invalid custom_id")).isFalse();
        assertThat(KbModelCatalogService.batchUnsupported(400, null)).isFalse();
    }
}
