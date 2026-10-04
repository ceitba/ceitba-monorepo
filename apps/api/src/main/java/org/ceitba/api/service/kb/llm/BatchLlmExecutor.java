package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.external.llm.DoBatchSlotException;
import org.ceitba.api.external.llm.DoQuotaTracker;
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
    private final DoQuotaTracker quota;
    private final java.time.Clock clock;

    public BatchLlmExecutor(LlmBatchClient client, ObjectMapper json) {
        this(client, json, null, java.time.Clock.systemUTC());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public BatchLlmExecutor(LlmBatchClient client, ObjectMapper json, DoQuotaTracker quota, java.time.Clock clock) {
        this.client = client;
        this.json = json;
        this.quota = quota;
        this.clock = clock;
    }

    public record Submitted(String fileId, String batchId) {}

    public record Collected(Map<String, LlmOutputParser.LlmResult> results, byte[] output, byte[] errors) {}

    // Throws DoBatchSlotException (without calling DO) while the last quota
    // snapshot says no batch creation is left this hour.
    private void checkSlot() {
        if (quota == null) return;
        quota.batchCreationWait().ifPresent(w -> {
            throw new DoBatchSlotException(w.reason(), w.until());
        });
    }

    // model: the catalog id (decides the provider); batchModelId: the id the
    // JSONL lines carry (KbLlmRouter.batchModelId).
    public Submitted submit(String name, String model, String batchModelId, List<LlmLine> lines, String requestId) {
        return submit(name, model, batchModelId, lines.iterator(), requestId);
    }

    // The lines are written to a temp file as the iterator yields them (the
    // caller pages them from the database) and the file is uploaded from
    // disk: a batch never sits in the heap.
    public Submitted submit(String name, String model, String batchModelId, java.util.Iterator<LlmLine> lines,
                            String requestId) {
        var provider = KbChatPayloads.batchProvider(model);
        if (provider == null) throw new LlmApiException(0, model + " has no batch support");
        checkSlot();
        java.nio.file.Path tmp = null;
        try {
            tmp = java.nio.file.Files.createTempFile("kb-batch-", ".jsonl");
            try (var out = new java.io.BufferedWriter(new java.io.OutputStreamWriter(
                    java.nio.file.Files.newOutputStream(tmp), StandardCharsets.UTF_8))) {
                while (lines.hasNext()) {
                    var l = lines.next();
                    out.write(KbChatPayloads.batchLine(l.customId(), l.params(), provider, batchModelId, json).toString());
                    out.write('\n');
                }
            }
            var file = client.createFile(name);
            client.upload(file.uploadUrl(), tmp);
            var info = client.createBatch(file.fileId(), requestId, provider,
                "openai".equals(provider) ? KbChatPayloads.CHAT_ENDPOINT : null);
            return new Submitted(file.fileId(), info.id());
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        } finally {
            deleteQuietly(tmp);
        }
    }

    // Output and error files of a finished batch, downloaded to temp files
    // (null when absent; the caller deletes them). Partial for failed/expired.
    public record CollectedFiles(java.nio.file.Path output, java.nio.file.Path errors) {
        public void delete() {
            deleteQuietly(output);
            deleteQuietly(errors);
        }
    }

    public CollectedFiles collectToFiles(String batchId, boolean completed) {
        java.nio.file.Path out = null;
        java.nio.file.Path err = null;
        try {
            var res = client.results(batchId);
            if (res.outputFileUrl() != null) {
                out = java.nio.file.Files.createTempFile("kb-batch-out-", ".jsonl");
                client.downloadTo(res.outputFileUrl(), out);
            }
            if (res.errorFileUrl() != null) {
                err = java.nio.file.Files.createTempFile("kb-batch-err-", ".jsonl");
                client.downloadTo(res.errorFileUrl(), err);
            }
        } catch (LlmApiException e) {
            if (completed) {
                deleteQuietly(out);
                deleteQuietly(err);
                throw e;
            }
        } catch (java.io.IOException e) {
            deleteQuietly(out);
            deleteQuietly(err);
            throw new java.io.UncheckedIOException(e);
        }
        return new CollectedFiles(out, err);
    }

    static void deleteQuietly(java.nio.file.Path p) {
        if (p == null) return;
        try {
            java.nio.file.Files.deleteIfExists(p);
        } catch (java.io.IOException ignored) {
            // best effort
        }
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
