package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

// DigitalOcean serverless inference, batch API (https://inference.do-ai.run).
// Bearer = a DO model access key. Anthropic requests: provider "anthropic",
// no `endpoint`. Responses are read defensively (field names vary between
// providers/versions: id|batch_id, file_id|id, upload_url|url).
public class DoBatchClient implements LlmBatchClient {

    private final String baseUrl;
    private final String apiKey;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(20))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

    public DoBatchClient(String baseUrl, String apiKey, ObjectMapper json) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.json = json;
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public FileUpload createFile(String fileName) {
        var node = call("POST", "/v1/batches/files", Map.of("file_name", fileName));
        var fileId = text(node, "file_id", "id");
        var url = text(node, "upload_url", "url");
        if (fileId == null || url == null) throw new LlmApiException(0, "Unexpected createFile response: " + node);
        return new FileUpload(fileId, url);
    }

    @Override
    public void upload(String uploadUrl, byte[] bytes) {
        var req = HttpRequest.newBuilder(URI.create(uploadUrl))
            .timeout(Duration.ofMinutes(5))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes))
            .build();
        var res = send(req);
        if (res.statusCode() / 100 != 2) {
            throw new LlmApiException(res.statusCode(), "Upload failed: " + abbreviate(new String(res.body())));
        }
    }

    @Override
    public BatchInfo createBatch(String fileId, String requestId, String provider, String endpoint) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("file_id", fileId);
        body.put("provider", provider);
        body.put("completion_window", "24h");
        body.put("request_id", requestId);
        if (endpoint != null) body.put("endpoint", endpoint);
        return info(call("POST", "/v1/batches", body));
    }

    @Override
    public BatchInfo get(String batchId) {
        return info(call("GET", "/v1/batches/" + batchId, null));
    }

    @Override
    public BatchResults results(String batchId) {
        var node = call("GET", "/v1/batches/" + batchId + "/results", null);
        boolean available = node.path("result_available").asBoolean(node.hasNonNull("output_file_url"));
        return new BatchResults(available, text(node, "output_file_url"), text(node, "error_file_url"));
    }

    @Override
    public byte[] download(String url) {
        var res = send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofMinutes(5)).GET().build());
        if (res.statusCode() / 100 != 2) throw new LlmApiException(res.statusCode(), "Download failed");
        return res.body();
    }

    @Override
    public void cancel(String batchId) {
        call("POST", "/v1/batches/" + batchId + "/cancel", Map.of());
    }

    private BatchInfo info(JsonNode node) {
        var id = text(node, "id", "batch_id");
        var status = text(node, "status");
        return new BatchInfo(id, status == null ? null : status.toLowerCase(java.util.Locale.ROOT), node.toString());
    }

    private JsonNode call(String method, String path, Object body) {
        try {
            var b = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + apiKey)
                .header("Accept", "application/json");
            if (body == null) {
                b.method(method, HttpRequest.BodyPublishers.noBody());
            } else {
                b.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
            }
            var res = send(b.build());
            var text = new String(res.body(), java.nio.charset.StandardCharsets.UTF_8);
            if (res.statusCode() / 100 != 2) {
                throw new LlmApiException(res.statusCode(), method + " " + path + " -> " + res.statusCode() + ": "
                    + abbreviate(text));
            }
            return text.isBlank() ? json.createObjectNode() : json.readTree(text);
        } catch (IOException e) {
            throw new LlmApiException(0, method + " " + path + ": " + e.getMessage(), e);
        }
    }

    private HttpResponse<byte[]> send(HttpRequest req) {
        try {
            return http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new LlmApiException(0, req.method() + " " + req.uri().getPath() + ": " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmApiException(0, "Interrupted");
        }
    }

    private static String text(JsonNode node, String... names) {
        for (var n : names) {
            var v = node.path(n);
            if (v.isTextual() && !v.asText().isBlank()) return v.asText();
        }
        var data = node.path("data");
        if (data.isObject()) return text(data, names);
        return null;
    }

    private static String abbreviate(String s) {
        return s.length() <= 500 ? s : s.substring(0, 500) + "...";
    }
}
