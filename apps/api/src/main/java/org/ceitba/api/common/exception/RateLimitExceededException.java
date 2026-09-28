package org.ceitba.api.common.exception;

// A per-user quota (service/ratelimit/UserRateLimiter) is exhausted. Mapped
// to 429 with Retry-After, the same shape RateLimitFilter answers per IP.
public class RateLimitExceededException extends DomainException {

    private final long retryAfterSeconds;

    public RateLimitExceededException(long retryAfterSeconds) {
        super("Rate limit exceeded. Retry in " + retryAfterSeconds + "s.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
