package org.ceitba.api.external.llm;

import java.util.List;

// No embedding endpoint (KB_EMBEDDING_BASE_URL empty).
public class UnconfiguredEmbeddingClient implements EmbeddingClient {

    @Override
    public boolean available() {
        return false;
    }

    @Override
    public List<float[]> embed(String model, List<String> inputs) {
        throw new LlmApiException(0, "embeddings are not configured");
    }
}
