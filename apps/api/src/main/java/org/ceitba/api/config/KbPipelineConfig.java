package org.ceitba.api.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.DoBatchClient;
import org.ceitba.api.external.llm.DoChatClient;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.SyncChatClient;
import org.ceitba.api.external.llm.UnconfiguredLlmBatchClient;
import org.ceitba.api.external.llm.UnconfiguredSyncChatClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Picks the inference clients (batch and sync): the fakes (kb.llm.use-fake),
// DigitalOcean with a key, or disabled clients.
@Configuration
@EnableConfigurationProperties({KbPipelineProperties.class, KbLlmProperties.class})
public class KbPipelineConfig {

    private static final Logger log = LoggerFactory.getLogger(KbPipelineConfig.class);

    @Bean
    public LlmBatchClient llmBatchClient(KbLlmProperties props, ObjectMapper json) {
        if (props.useFake()) {
            log.warn("KB pipeline: FAKE inference (KB_LLM_USE_FAKE=true); results are simulated");
            return new FakeLlmBatchClient(json);
        }
        if (!props.hasKey()) {
            log.info("KB pipeline: inference not configured (KB_LLM_API_KEY); runs can only be dry");
            return new UnconfiguredLlmBatchClient();
        }
        return new DoBatchClient(props.baseUrl(), props.apiKey(), json);
    }

    @Bean
    public SyncChatClient syncChatClient(KbLlmProperties props, ObjectMapper json) {
        if (props.useFake()) return new FakeSyncChatClient(json);
        if (!props.hasKey()) return new UnconfiguredSyncChatClient();
        return new DoChatClient(props.baseUrl(), props.apiKey(), json, props.requestTimeout());
    }

    @Bean
    public org.ceitba.api.external.llm.DoModelCatalog doModelCatalog(KbLlmProperties props, ObjectMapper json) {
        if (props.useFake()) return new org.ceitba.api.external.llm.FakeDoModelCatalog();
        return new org.ceitba.api.external.llm.HttpDoModelCatalog(json);
    }
}
