package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Inference for the wiki pipeline, bound from kb.llm.*:
//   KB_LLM_BASE_URL=https://inference.do-ai.run
//   KB_LLM_API_KEY=<DigitalOcean model access key>   (empty = dry runs only: 503 KB_LLM_UNCONFIGURED)
//   KB_EXECUTION_MODE=auto|batch|sync                (env default; runtime setting executionMode wins)
//   KB_SYNC_CONCURRENCY=4                            parallel chat completions in sync mode
//   KB_LLM_USE_FAKE=false                            in-memory fakes for both modes (tests, local demo)
@ConfigurationProperties(prefix = "kb.llm")
public record KbLlmProperties(String baseUrl, String apiKey, String executionMode, Integer syncConcurrency,
                              boolean useFake) {

    public KbLlmProperties {
        baseUrl = baseUrl == null || baseUrl.isBlank() ? "https://inference.do-ai.run" : baseUrl.trim();
        executionMode = executionMode == null || executionMode.isBlank() ? "auto"
            : executionMode.trim().toLowerCase(java.util.Locale.ROOT);
        syncConcurrency = syncConcurrency == null || syncConcurrency < 1 ? 4 : syncConcurrency;
    }

    public boolean hasKey() {
        return apiKey != null && !apiKey.isBlank();
    }
}
