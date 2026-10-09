package org.ceitba.api.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.kb.KbPageChunk;
import org.ceitba.api.external.llm.DoBatchClient;
import org.ceitba.api.external.llm.DoChatClient;
import org.ceitba.api.external.llm.DoQuotaTracker;
import org.ceitba.api.external.llm.EmbeddingClient;
import org.ceitba.api.external.llm.FakeEmbeddingClient;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.OpenAiEmbeddingClient;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.external.llm.UnconfiguredEmbeddingClient;
import org.ceitba.api.external.llm.UnconfiguredLlmBatchClient;
import org.ceitba.api.external.llm.UnconfiguredSyncChatClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Picks the inference clients (batch and sync): the fakes (kb.llm.use-fake),
// DigitalOcean with a key, or disabled clients. Same for the embedding client
// (kb.embeddings.*).
@Configuration
@EnableConfigurationProperties({KbPipelineProperties.class, KbLlmProperties.class, KbEmbeddingProperties.class})
public class KbPipelineConfig {

    private static final Logger log = LoggerFactory.getLogger(KbPipelineConfig.class);

    @Bean
    public DoQuotaTracker doQuotaTracker(java.time.Clock clock) {
        return new DoQuotaTracker(clock);
    }

    @Bean
    public LlmBatchClient llmBatchClient(KbLlmProperties props, ObjectMapper json, DoQuotaTracker quota) {
        if (props.useFake()) {
            log.warn("KB pipeline: FAKE inference (KB_LLM_USE_FAKE=true); results are simulated");
            return new FakeLlmBatchClient(json);
        }
        if (!props.hasKey()) {
            log.info("KB pipeline: inference not configured (KB_LLM_API_KEY); runs can only be dry");
            return new UnconfiguredLlmBatchClient();
        }
        var client = new DoBatchClient(props.baseUrl(), props.apiKey(), json, quota);
        // No quota probe: a POST /v1/batches with a bogus file_id still spends one of
        // the 5 hourly creations (verified), so counters come only from real calls.
        return client;
    }

    @Bean
    public SyncChatClient syncChatClient(KbLlmProperties props, ObjectMapper json, DoQuotaTracker quota) {
        if (props.useFake()) return new FakeSyncChatClient(json);
        if (!props.hasKey()) return new UnconfiguredSyncChatClient();
        return new DoChatClient(props.baseUrl(), props.apiKey(), json, props.requestTimeout(), quota);
    }

    @Bean
    public EmbeddingClient embeddingClient(KbEmbeddingProperties props, ObjectMapper json) {
        if (props.useFake()) return new FakeEmbeddingClient(KbPageChunk.DIMENSIONS);
        if (!props.configured()) {
            log.info("KB embeddings: not configured (KB_EMBEDDING_BASE_URL); pages are not embedded");
            return new UnconfiguredEmbeddingClient();
        }
        return new OpenAiEmbeddingClient(props.baseUrl(), props.apiKey(), json, props.requestTimeout());
    }

    @Bean
    public org.ceitba.api.external.llm.DoModelCatalog doModelCatalog(KbLlmProperties props, ObjectMapper json) {
        if (props.useFake()) return new org.ceitba.api.external.llm.FakeDoModelCatalog();
        return new org.ceitba.api.external.llm.HttpDoModelCatalog(json);
    }
}
