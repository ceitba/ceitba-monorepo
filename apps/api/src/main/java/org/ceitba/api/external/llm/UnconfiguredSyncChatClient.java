package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

public class UnconfiguredSyncChatClient implements SyncChatClient {

    @Override public boolean available() { return false; }

    @Override
    public JsonNode complete(JsonNode body) {
        throw new LlmApiException(0, "Inference is not configured (KB_LLM_API_KEY)");
    }

    @Override
    public List<String> listModels() {
        throw new LlmApiException(0, "Inference is not configured (KB_LLM_API_KEY)");
    }
}
