package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.external.llm.LlmBatchClient;
import org.ceitba.api.external.llm.LlmOutputParser;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// BATCH mode: one DO batch per call of submit(); polled by the run engine.
@Component
public class BatchLlmExecutor {

    private final LlmBatchClient client;
    private final ObjectMapper json;

    public BatchLlmExecutor(LlmBatchClient client, ObjectMapper json) {
        this.client = client;
        this.json = json;
    }

    public record Submitted(String fileId, String batchId) {}

    public record Collected(Map<String, LlmOutputParser.LlmResult> results, byte[] output, byte[] errors) {}

    // model: the catalog id (decides the provider); batchModelId: the id the
    // JSONL lines carry (KbLlmRouter.batchModelId).
    public Submitted submit(String name, String model, String batchModelId, List<LlmLine> lines, String requestId) {
        var provider = KbChatPayloads.batchProvider(model);
        if (provider == null) throw new LlmApiException(0, model + " has no batch support");
        var sb = new StringBuilder();
        for (var l : lines) {
            sb.append(KbChatPayloads.batchLine(l.customId(), l.params(), provider, batchModelId, json)).append('\n');
        }
        var bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        var file = client.createFile(name);
        client.upload(file.uploadUrl(), bytes);
        var info = client.createBatch(file.fileId(), requestId, provider,
            "openai".equals(provider) ? KbChatPayloads.CHAT_ENDPOINT : null);
        return new Submitted(file.fileId(), info.id());
    }

    // The batch DO created for this request_id earlier, if it lists one.
    public java.util.Optional<LlmBatchClient.BatchInfo> findByRequestId(String requestId) {
        return client.findByRequestId(requestId);
    }

    public LlmBatchClient.BatchInfo poll(String batchId) {
        return client.get(batchId);
    }

    // Output and error files of a finished batch (partial for failed/expired).
    public Collected collect(String batchId, boolean completed) {
        byte[] out = null;
        byte[] err = null;
        try {
            var res = client.results(batchId);
            if (res.outputFileUrl() != null) out = client.download(res.outputFileUrl());
            if (res.errorFileUrl() != null) err = client.download(res.errorFileUrl());
        } catch (LlmApiException e) {
            if (completed) throw e;
        }
        var parsed = new HashMap<String, LlmOutputParser.LlmResult>();
        parsed.putAll(LlmOutputParser.parse(err, json));
        parsed.putAll(LlmOutputParser.parse(out, json));
        return new Collected(parsed, out, err);
    }

    public void cancel(String batchId) {
        client.cancel(batchId);
    }
}
