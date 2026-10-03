package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// Classification of DigitalOcean batch errors, on the exact strings DO returned.
class DoBatchErrorsTest {

    static final String VALIDATION = "JSONL model validation failed: 1 unsupported model(s), e.g. unsupported model "
        + "\"openai-gpt-6-luna\": not available on DigitalOcean";
    static final String RATE_LIMIT_BODY = "{\"error\":{\"message\":\"Rate limit exceeded: batch_create_per_minute, "
        + "batch_creations_per_hour.\",\"type\":\"rate_limit_exceeded_error\"}}";

    @Test
    void validationFailureIsAnUnsupportedModel() {
        assertThat(DoBatchErrors.classifyFailure(VALIDATION)).isEqualTo(DoBatchErrors.Kind.UNSUPPORTED_MODEL);
        assertThat(DoBatchErrors.classify(400, VALIDATION)).isEqualTo(DoBatchErrors.Kind.UNSUPPORTED_MODEL);
    }

    @Test
    void rateLimitIsRetryableNotFatal() {
        assertThat(DoBatchErrors.classify(429, "POST /v1/batches -> 429: " + RATE_LIMIT_BODY))
            .isEqualTo(DoBatchErrors.Kind.RATE_LIMITED);
        // Even when the status is lost, the body says so.
        assertThat(DoBatchErrors.classify(400, RATE_LIMIT_BODY)).isEqualTo(DoBatchErrors.Kind.RATE_LIMITED);
    }

    @Test
    void otherErrors() {
        assertThat(DoBatchErrors.classify(0, "POST /v1/batches: timeout")).isEqualTo(DoBatchErrors.Kind.TRANSIENT);
        assertThat(DoBatchErrors.classify(503, "unavailable")).isEqualTo(DoBatchErrors.Kind.TRANSIENT);
        assertThat(DoBatchErrors.classify(400, "file must have a .jsonl extension")).isEqualTo(DoBatchErrors.Kind.REJECTED);
        assertThat(DoBatchErrors.classify(401, "invalid api key")).isEqualTo(DoBatchErrors.Kind.REJECTED);
        assertThat(DoBatchErrors.classifyFailure("batch expired")).isEqualTo(DoBatchErrors.Kind.REJECTED);
        assertThat(DoBatchErrors.classifyFailure(null)).isEqualTo(DoBatchErrors.Kind.REJECTED);
    }

    @Test
    void doBatchClientReadsErrorMessageAndTheEdgesList() throws Exception {
        var json = new ObjectMapper();
        var failed = json.readTree("""
            {"id":"b-1","status":"failed","error_message":%s,"request_counts":{"total":0,"completed":0,"failed":0}}
            """.formatted(json.writeValueAsString(VALIDATION)));
        var info = DoBatchClient.info(failed);
        assertThat(info.status()).isEqualTo("failed");
        assertThat(info.finished()).isTrue();
        assertThat(info.errorMessage()).isEqualTo(VALIDATION);

        var list = json.readTree("""
            {"edges":[{"node":{"id":"b-1","request_id":"r:DIGEST:1:m","status":"in_progress"}},
                      {"node":{"id":"b-2","request_id":"other","status":"completed"}}],
             "page_info":{"has_next_page":false}}
            """);
        assertThat(DoBatchClient.batchList(list)).extracting(n -> n.path("id").asText()).containsExactly("b-1", "b-2");
        assertThat(DoBatchClient.info(json.readTree("{\"id\":\"b\",\"status\":\"COMPLETED\"}")).errorMessage()).isNull();
    }
}
