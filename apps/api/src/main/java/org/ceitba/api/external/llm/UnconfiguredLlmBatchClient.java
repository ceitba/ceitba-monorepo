package org.ceitba.api.external.llm;

// No KB_LLM_API_KEY: the pipeline can preview, baseline and dry-run, but
// cannot submit (services answer 503 KB_LLM_UNCONFIGURED first).
public class UnconfiguredLlmBatchClient implements LlmBatchClient {

    @Override public boolean available() { return false; }
    @Override public FileUpload createFile(String fileName) { throw unavailable(); }
    @Override public void upload(String uploadUrl, byte[] bytes) { throw unavailable(); }
    @Override public BatchInfo createBatch(String fileId, String requestId, String provider, String endpoint) {
        throw unavailable();
    }
    @Override public BatchInfo get(String batchId) { throw unavailable(); }
    @Override public BatchResults results(String batchId) { throw unavailable(); }
    @Override public byte[] download(String url) { throw unavailable(); }
    @Override public void cancel(String batchId) { throw unavailable(); }

    private static LlmApiException unavailable() {
        return new LlmApiException(0, "Batch inference is not configured (KB_LLM_API_KEY)");
    }
}
