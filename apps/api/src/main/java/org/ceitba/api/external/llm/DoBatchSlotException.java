package org.ceitba.api.external.llm;

import java.time.OffsetDateTime;

// Raised before calling DO: the last quota snapshot says no batch creation is
// left this hour. Carries when to look again. Classified as RATE_LIMITED
// (status 429), so callers' existing back-off paths apply, but with `retryAt`
// instead of the generic back-off.
public class DoBatchSlotException extends LlmApiException {

    private final OffsetDateTime retryAt;

    public DoBatchSlotException(String message, OffsetDateTime retryAt) {
        super(429, message + " (rate_limit_exceeded)");
        this.retryAt = retryAt;
    }

    public OffsetDateTime retryAt() { return retryAt; }
}
