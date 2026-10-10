package org.ceitba.api.external.llm;

// The embedding server gave no HTTP answer: connection refused or reset after
// the retries, or a timeout. Unlike an error about one input, every later call
// would fail the same way.
public class EmbeddingUnreachableException extends LlmApiException {

    public EmbeddingUnreachableException(String message) {
        super(0, message);
    }
}
