package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

// Synchronous OpenAI-compatible chat completions on DigitalOcean serverless
// inference (POST /v1/chat/completions), for models without batch support
// (GLM, DeepSeek, ...). Same model access key as the batch API.
public interface SyncChatClient {

    boolean available();

    // One completion. Retries 429/5xx/I-O with back-off; throws LlmApiException
    // when it finally fails.
    JsonNode complete(JsonNode body);

    // GET /v1/models: the model ids the key can use.
    List<String> listModels();
}
