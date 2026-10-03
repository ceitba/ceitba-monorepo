package org.ceitba.api.external.llm;

// A failed call to the batch inference API (status 0 = no response).
public class LlmApiException extends RuntimeException {

    private final int status;

    public LlmApiException(int status, String message) {
        super(message);
        this.status = status;
    }

    public LlmApiException(int status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public int status() { return status; }
}
