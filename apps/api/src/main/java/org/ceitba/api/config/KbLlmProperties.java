package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.time.Duration;

// Inference for the wiki pipeline, bound from kb.llm.*:
//   KB_LLM_BASE_URL=https://inference.do-ai.run
//   KB_LLM_API_KEY=<DigitalOcean model access key>   (empty = dry runs only: 503 KB_LLM_UNCONFIGURED)
//   KB_EXECUTION_MODE=auto|batch|sync                (env default; runtime setting executionMode wins)
//   KB_SYNC_CONCURRENCY=16                           parallel chat completions in sync mode
//   KB_LLM_USE_FAKE=false                            in-memory fakes for both modes (tests, local demo)
//   KB_LLM_REQUEST_TIMEOUT=PT5M                      one sync chat completion; a timeout is not retried
//                                                    by the client (the run engine resends it once)
@ConfigurationProperties(prefix = "kb.llm")
public record KbLlmProperties(String baseUrl, String apiKey, String executionMode, Integer syncConcurrency,
                              boolean useFake, Duration requestTimeout) {

    @ConstructorBinding
    public KbLlmProperties {
        baseUrl = baseUrl == null || baseUrl.isBlank() ? "https://inference.do-ai.run" : baseUrl.trim();
        executionMode = executionMode == null || executionMode.isBlank() ? "auto"
            : executionMode.trim().toLowerCase(java.util.Locale.ROOT);
        syncConcurrency = syncConcurrency == null || syncConcurrency < 1 ? 16 : syncConcurrency;
        requestTimeout = requestTimeout == null || requestTimeout.isNegative() || requestTimeout.isZero()
            ? Duration.ofMinutes(5) : requestTimeout;
    }

    public KbLlmProperties(String baseUrl, String apiKey, String executionMode, Integer syncConcurrency,
                           boolean useFake) {
        this(baseUrl, apiKey, executionMode, syncConcurrency, useFake, null);
    }

    public boolean hasKey() {
        return apiKey != null && !apiKey.isBlank();
    }
}
