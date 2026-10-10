package org.ceitba.api.external.llm;

import java.util.List;

// OpenAI-compatible text embeddings (POST /v1/embeddings).
public interface EmbeddingClient {

    // False when no embedding endpoint is configured.
    boolean available();

    // One vector per input, in input order. Throws LlmApiException.
    List<float[]> embed(String model, List<String> inputs);
}
