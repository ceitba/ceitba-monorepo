package org.ceitba.api.external.llm;

// Batch inference (DigitalOcean serverless inference; commercial providers
// anthropic and openai only).
// Every call throws LlmApiException on failure. Implementations:
// DoBatchClient (real), FakeLlmBatchClient (kb.llm.use-fake, tests and
// offline dev), UnconfiguredLlmBatchClient (no key: available() is false).
public interface LlmBatchClient {

    boolean available();

    // POST /v1/batches/files {file_name} -> where to PUT the JSONL.
    FileUpload createFile(String fileName);

    // PUT of the raw bytes to the upload URL (no extra headers).
    void upload(String uploadUrl, byte[] bytes);

    // The same from a file, streamed (a batch file can be large). Default: reads it.
    default void upload(String uploadUrl, java.nio.file.Path file) {
        try {
            upload(uploadUrl, java.nio.file.Files.readAllBytes(file));
        } catch (java.io.IOException e) {
            throw new LlmApiException(0, "Reading " + file + ": " + e.getMessage(), e);
        }
    }

    // POST /v1/batches {file_id, provider, completion_window: 24h, request_id[, endpoint]}.
    // provider: anthropic (no endpoint) or openai (endpoint /v1/chat/completions).
    BatchInfo createBatch(String fileId, String requestId, String provider, String endpoint);

    // GET /v1/batches/{id}.
    BatchInfo get(String batchId);

    // GET /v1/batches/{id}/results.
    BatchResults results(String batchId);

    // Downloads an output/error file URL (signed; no auth header).
    byte[] download(String url);

    // The same into a file, streamed. Default: downloads into memory first.
    default void downloadTo(String url, java.nio.file.Path file) {
        try {
            java.nio.file.Files.write(file, download(url));
        } catch (java.io.IOException e) {
            throw new LlmApiException(0, "Writing " + file + ": " + e.getMessage(), e);
        }
    }

    // POST /v1/batches/{id}/cancel.
    void cancel(String batchId);

    // The batch created with this request_id, if DO lists one (GET
    // /v1/batches: {edges: [{node: {...}}], page_info}); used before
    // re-creating a batch whose creation got no clear answer.
    // Refreshes the quota snapshot for free (DoBatchClient); a no-op elsewhere.
    default void probeQuota() {}

    default java.util.Optional<BatchInfo> findByRequestId(String requestId) {
        return java.util.Optional.empty();
    }

    record FileUpload(String fileId, String uploadUrl) {}

    // status: validating | queued | in_progress | completed | failed |
    // cancelling | cancelled | expired (lowercase, as DO reports it).
    // errorMessage: DO's error_message (e.g. 'JSONL model validation failed:
    // ...'), null when none.
    record BatchInfo(String id, String status, String raw, String errorMessage) {

        public BatchInfo(String id, String status, String raw) {
            this(id, status, raw, null);
        }

        public boolean finished() {
            return switch (status == null ? "" : status) {
                case "completed", "failed", "cancelled", "expired" -> true;
                default -> false;
            };
        }
    }

    record BatchResults(boolean available, String outputFileUrl, String errorFileUrl) {}
}
