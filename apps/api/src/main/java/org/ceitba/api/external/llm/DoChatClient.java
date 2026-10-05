package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.concurrent.ThreadLocalRandom;

// DigitalOcean serverless inference, OpenAI-compatible chat completions.
// A 429 tokens_per_day throws DoQuotaExhaustedException at once (no retries).
// Every response's x-ratelimit-* headers go to the DoQuotaTracker.
// 429, 5xx and I/O errors are retried up to 4 times with exponential
// back-off (honouring Retry-After). A request that times out is not retried
// here: four more full timeouts would hold one page for 20+ minutes, and the
// run engine already resends unanswered requests once.
public class DoChatClient implements SyncChatClient {

    static final int MAX_ATTEMPTS = 4;

    private final String baseUrl;
    private final String apiKey;
    private final ObjectMapper json;
    private final Duration timeout;
    private final DoQuotaTracker quota;
    // Path prefix of the OpenAI routes: "/v1" for DO (base URL is the host),
    // "" for custom endpoints whose base URL already ends in /v1.
    private String apiPrefix = "/v1";
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();

    public DoChatClient(String baseUrl, String apiKey, ObjectMapper json) {
        this(baseUrl, apiKey, json, Duration.ofMinutes(5));
    }

    public DoChatClient(String baseUrl, String apiKey, ObjectMapper json, Duration timeout) {
        this(baseUrl, apiKey, json, timeout, null);
    }

    public DoChatClient(String baseUrl, String apiKey, ObjectMapper json, Duration timeout, DoQuotaTracker quota) {
        this.quota = quota;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.json = json;
        this.timeout = timeout;
    }

    // A custom OpenAI-compatible server (llama.cpp, vLLM, ...): baseUrl includes
    // /v1 (calls go to {baseUrl}/chat/completions and {baseUrl}/models); a blank
    // key sends no Authorization header.
    public static DoChatClient openAiCompatible(String baseUrl, String apiKey, ObjectMapper json, Duration timeout) {
        var c = new DoChatClient(baseUrl, apiKey == null ? "" : apiKey, json, timeout, null);
        c.apiPrefix = "";
        return c;
    }

    private HttpRequest.Builder request(String path) {
        var b = HttpRequest.newBuilder(URI.create(baseUrl + apiPrefix + path));
        if (apiKey != null && !apiKey.isBlank()) b.header("Authorization", "Bearer " + apiKey);
        return b;
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public JsonNode complete(JsonNode body) {
        long delay = 1000;
        for (int attempt = 1; ; attempt++) {
            int status = 0;
            String detail;
            long retryAfter = -1;
            try {
                var req = request("/chat/completions")
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)))
                    .build();
                var res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                status = res.statusCode();
                if (quota != null) quota.observe(res.headers());
                if (status / 100 == 2) return json.readTree(res.body());
                detail = res.body().length() > 500 ? res.body().substring(0, 500) : res.body();
                // The daily token bucket does not refill within a retry's reach: no retries.
                if (status == 429 && DoQuotaExhaustedException.isDailyTokens(res.body())) {
                    throw new DoQuotaExhaustedException("chat/completions -> 429: " + detail);
                }
                retryAfter = res.headers().firstValue("Retry-After").map(v -> {
                    try { return Long.parseLong(v.trim()) * 1000; } catch (NumberFormatException e) { return -1L; }
                }).orElse(-1L);
            } catch (java.net.http.HttpTimeoutException e) {
                throw new LlmApiException(0, "chat/completions -> 0: timed out after " + timeout.toSeconds() + " s");
            } catch (IOException e) {
                detail = e.getMessage();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmApiException(0, "Interrupted");
            }
            boolean transientError = status == 0 || status == 429 || status >= 500;
            if (!transientError || attempt >= MAX_ATTEMPTS) {
                throw new LlmApiException(status, "chat/completions -> " + status + ": " + detail);
            }
            sleep(retryAfter > 0 ? Math.min(retryAfter, 60_000) : delay + ThreadLocalRandom.current().nextLong(250));
            delay *= 2;
        }
    }

    @Override
    public List<String> listModels() {
        try {
            var req = request("/models")
                .timeout(Duration.ofSeconds(60))
                .GET().build();
            var res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() / 100 != 2) throw new LlmApiException(res.statusCode(), "GET /v1/models failed");
            var out = new ArrayList<String>();
            for (var m : json.readTree(res.body()).path("data")) {
                if (m.hasNonNull("id")) out.add(m.path("id").asText());
            }
            return out;
        } catch (IOException e) {
            throw new LlmApiException(0, "GET /v1/models: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmApiException(0, "Interrupted");
        }
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
