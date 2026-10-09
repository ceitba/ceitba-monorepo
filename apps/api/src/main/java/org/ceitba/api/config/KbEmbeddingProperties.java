package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.time.Duration;

// Embeddings of the wiki pages (docs/SUBJECT-WIKI.md "Embeddings"), bound from kb.embeddings.*.
// Self-hosted: the ceitba-embeddings service of docker-compose.yml (llama.cpp serving EmbeddingGemma 2).
//   KB_EMBEDDING_BASE_URL=http://ceitba-embeddings:8080/v1   any OpenAI-compatible /v1 (llama.cpp, TEI,
//                                    vLLM, a hosted API): calls {base}/embeddings. Empty = embeddings off.
//   KB_EMBEDDING_API_KEY=            sent as a Bearer token when set
//   KB_EMBEDDING_MODEL=embeddinggemma-2   recorded per row; changing it re-embeds every page. Must return
//                                         KbPageChunk.DIMENSIONS-long vectors
//   KB_EMBEDDING_QUERY_TEMPLATE / KB_EMBEDDING_DOCUMENT_TEMPLATE   the model's retrieval prompts
//                                    ({query}; {title}, {text}); defaults are EmbeddingGemma's
//   KB_EMBEDDING_USE_FAKE=false      deterministic in-memory vectors (default KB_LLM_USE_FAKE)
//   KB_EMBEDDING_BATCH_SIZE=16       inputs per /embeddings request
//   KB_EMBEDDING_REQUEST_TIMEOUT=PT2M
// KB_EMBEDDINGS_ENABLED and KB_EMBEDDING_INTERVAL (kb.embeddings.enabled /
// .interval) are read by KbEmbeddingJob's annotations directly.
// Unconfigured (no base URL) = nothing is embedded and search throws FeatureNotConfiguredException (501).
@ConfigurationProperties(prefix = "kb.embeddings")
public record KbEmbeddingProperties(String baseUrl, String apiKey, String model, String queryTemplate,
                                    String documentTemplate, boolean useFake, Integer batchSize,
                                    Duration requestTimeout) {

    // EmbeddingGemma's retrieval prompts (model card, "SearchQuery" / "Document").
    public static final String GEMMA_QUERY = "task: search result | query: {query}";
    public static final String GEMMA_DOCUMENT = "title: {title} | text: {text}";

    @ConstructorBinding
    public KbEmbeddingProperties {
        baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        model = model == null || model.isBlank() ? "embeddinggemma-2" : model.trim();
        queryTemplate = queryTemplate == null || queryTemplate.isBlank() ? GEMMA_QUERY : queryTemplate;
        documentTemplate = documentTemplate == null || documentTemplate.isBlank() ? GEMMA_DOCUMENT : documentTemplate;
        batchSize = batchSize == null || batchSize < 1 ? 16 : batchSize;
        requestTimeout = requestTimeout == null || requestTimeout.isNegative() || requestTimeout.isZero()
            ? Duration.ofMinutes(2) : requestTimeout;
    }

    public boolean configured() {
        return !baseUrl.isEmpty();
    }

    public String query(String query) {
        return queryTemplate.replace("{query}", query);
    }

    public String document(String title, String text) {
        return documentTemplate.replace("{title}", title).replace("{text}", text);
    }
}
