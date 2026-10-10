package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

// OpenAI-compatible POST {baseUrl}/embeddings: the self-hosted llama.cpp
// server (ceitba-embeddings in docker-compose.yml), or TEI, vLLM or a hosted
// API. A blank key sends no Authorization header. The body is only model, input
// and encoding_format (some providers reject unknown fields). 429, 5xx and
// connection errors are retried like DoChatClient (up to 4 attempts, exponential
// back-off, Retry-After honoured). As there, a timeout is not retried: four more
// full timeouts would only hold the sweep longer. No HTTP answer in the end
// (timeout, refused, reset) throws EmbeddingUnreachableException.
public class OpenAiEmbeddingClient implements EmbeddingClient {

    static final int MAX_ATTEMPTS = 4;

    private final String baseUrl;
    private final String apiKey;
    private final ObjectMapper json;
    private final Duration timeout;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();

    public OpenAiEmbeddingClient(String baseUrl, String apiKey, ObjectMapper json, Duration timeout) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.json = json;
        this.timeout = timeout;
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public List<float[]> embed(String model, List<String> inputs) {
        if (inputs.isEmpty()) return List.of();
        byte[] body;
        try {
            body = json.writeValueAsBytes(Map.of("model", model, "input", inputs, "encoding_format", "float"));
        } catch (IOException e) {
            throw new LlmApiException(0, "embeddings: " + e.getMessage(), e);
        }
        long delay = 1000;
        for (int attempt = 1; ; attempt++) {
            int status = 0;
            String detail;
            long retryAfter = -1;
            try {
                var b = HttpRequest.newBuilder(URI.create(baseUrl + "/embeddings"))
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body));
                if (apiKey != null && !apiKey.isBlank()) b.header("Authorization", "Bearer " + apiKey);
                var res = http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                status = res.statusCode();
                if (status / 100 == 2) return parse(res.body(), inputs.size());   // never retried
                detail = res.body().length() > 500 ? res.body().substring(0, 500) : res.body();
                retryAfter = res.headers().firstValue("Retry-After").map(v -> {
                    try { return Long.parseLong(v.trim()) * 1000; } catch (NumberFormatException e) { return -1L; }
                }).orElse(-1L);
            } catch (java.net.http.HttpTimeoutException e) {
                throw new EmbeddingUnreachableException("embeddings -> 0: timed out after " + timeout.toSeconds() + " s");
            } catch (IOException e) {
                detail = e.getMessage();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmApiException(0, "Interrupted");
            }
            boolean transientError = status == 0 || status == 429 || status >= 500;
            if (!transientError || attempt >= MAX_ATTEMPTS) {
                if (status == 0) throw new EmbeddingUnreachableException("embeddings -> 0: " + detail);
                throw new LlmApiException(status, "embeddings -> " + status + ": " + detail);
            }
            sleep(retryAfter > 0 ? Math.min(retryAfter, 60_000) : delay + ThreadLocalRandom.current().nextLong(250));
            delay *= 2;
        }
    }

    // data[] carries an index per vector; order by it, not by position.
    private List<float[]> parse(String body, int expected) {
        com.fasterxml.jackson.databind.JsonNode data;
        try {
            data = json.readTree(body).path("data");
        } catch (IOException e) {
            throw new LlmApiException(0, "embeddings: malformed response: " + e.getMessage(), e);
        }
        var out = new ArrayList<float[]>(java.util.Collections.nCopies(expected, (float[]) null));
        for (var item : data) {
            int index = item.path("index").asInt(-1);
            var e = item.path("embedding");
            if (index < 0 || index >= expected || !e.isArray()) {
                throw new LlmApiException(0, "embeddings: malformed response item");
            }
            var v = new float[e.size()];
            for (int i = 0; i < v.length; i++) v[i] = (float) e.get(i).asDouble();
            out.set(index, v);
        }
        if (out.contains(null)) throw new LlmApiException(0, "embeddings: " + data.size() + " vectors for " + expected + " inputs");
        return out;
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmApiException(0, "Interrupted");
        }
    }
}
