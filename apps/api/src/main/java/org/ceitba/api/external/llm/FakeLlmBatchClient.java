package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

// In-memory batch inference (kb.llm.use-fake=true) for tests and offline
// dev. Batches complete immediately (or stay in_progress while hold() is on)
// and answer every request through `responder`, which receives the
// request (FakeLlmRequest) and returns the tool input (or null for a failed
// request). Outputs use the Anthropic batch result shape.
public class FakeLlmBatchClient implements LlmBatchClient {

    private final ObjectMapper json;
    private final Map<String, byte[]> files = new ConcurrentHashMap<>();
    private final Map<String, String> batchFile = new ConcurrentHashMap<>();
    private final Map<String, String> status = new ConcurrentHashMap<>();
    private final List<FakeLlmRequest> submitted = java.util.Collections.synchronizedList(new ArrayList<>());
    private final AtomicInteger ids = new AtomicInteger();
    private volatile Function<FakeLlmRequest, JsonNode> responder = r -> null;
    private volatile boolean hold;
    private final List<String> cancelled = java.util.Collections.synchronizedList(new ArrayList<>());

    public FakeLlmBatchClient(ObjectMapper json) {
        this.json = json;
    }

    public void reset() {
        files.clear();
        batchFile.clear();
        status.clear();
        submitted.clear();
        cancelled.clear();
        responder = r -> null;
        hold = false;
    }

    public void respond(Function<FakeLlmRequest, JsonNode> responder) {
        this.responder = responder;
    }

    // New batches stay in_progress until release().
    public void hold(boolean hold) {
        this.hold = hold;
    }

    public void release() {
        hold = false;
        status.replaceAll((k, v) -> v.equals("in_progress") ? "completed" : v);
    }

    public List<FakeLlmRequest> submitted() {
        return List.copyOf(submitted);
    }

    public int batchCount() {
        return batchFile.size();
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public FileUpload createFile(String fileName) {
        var id = "file-" + ids.incrementAndGet();
        return new FileUpload(id, "fake://upload/" + id);
    }

    @Override
    public void upload(String uploadUrl, byte[] bytes) {
        files.put(uploadUrl.substring(uploadUrl.lastIndexOf('/') + 1), bytes);
    }

    @Override
    public BatchInfo createBatch(String fileId, String requestId, String provider, String endpoint) {
        if (!files.containsKey(fileId)) throw new LlmApiException(404, "No uploaded file " + fileId);
        var id = "batch-" + ids.incrementAndGet();
        batchFile.put(id, fileId);
        status.put(id, hold ? "in_progress" : "completed");
        for (var line : lines(fileId)) submitted.add(request(line));
        return get(id);
    }

    @Override
    public BatchInfo get(String batchId) {
        var s = status.get(batchId);
        if (s == null) throw new LlmApiException(404, "No batch " + batchId);
        return new BatchInfo(batchId, s, "{\"id\":\"" + batchId + "\",\"status\":\"" + s + "\"}");
    }

    @Override
    public BatchResults results(String batchId) {
        var s = get(batchId).status();
        if (!s.equals("completed")) return new BatchResults(false, null, null);
        return new BatchResults(true, "fake://output/" + batchId, null);
    }

    @Override
    public byte[] download(String url) {
        var batchId = url.substring(url.lastIndexOf('/') + 1);
        var sb = new StringBuilder();
        for (var line : lines(batchFile.get(batchId))) {
            var req = request(line);
            JsonNode input;
            try {
                input = responder.apply(req);
            } catch (RuntimeException e) {
                input = null;
            }
            ObjectNode out = json.createObjectNode();
            out.put("custom_id", req.customId());
            var result = out.putObject("result");
            if (input == null) {
                result.put("type", "errored");
                result.putObject("error").put("type", "fake_error").put("message", "no scripted answer");
            } else {
                result.put("type", "succeeded");
                var message = result.putObject("message");
                message.put("role", "assistant");
                var block = message.putArray("content").addObject();
                block.put("type", "tool_use");
                block.put("name", req.toolName());
                block.set("input", input);
                var usage = message.putObject("usage");
                usage.put("input_tokens", req.raw().toString().length() / 4);
                usage.put("output_tokens", input.toString().length() / 4);
            }
            sb.append(out).append('\n');
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public void cancel(String batchId) {
        cancelled.add(batchId);
        status.computeIfPresent(batchId, (k, v) -> "cancelled");
    }

    // Batch ids cancel() was called for.
    public List<String> cancelled() {
        return List.copyOf(cancelled);
    }

    // Anthropic lines {custom_id, params} or OpenAI lines {custom_id, body}.
    private static FakeLlmRequest request(JsonNode line) {
        var id = line.path("custom_id").asText();
        return line.has("params") ? FakeLlmRequest.fromAnthropic(id, line.path("params"))
            : FakeLlmRequest.fromChat(id, line.path("body"));
    }

    private List<JsonNode> lines(String fileId) {
        var out = new ArrayList<JsonNode>();
        var bytes = files.get(fileId);
        if (bytes == null) return out;
        for (var l : new String(bytes, StandardCharsets.UTF_8).split("\n")) {
            if (l.isBlank()) continue;
            try {
                out.add(json.readTree(l));
            } catch (Exception e) {
                throw new LlmApiException(400, "Invalid JSONL line");
            }
        }
        return out;
    }
}
