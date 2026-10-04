package org.ceitba.api.external.llm;

// DO answered 429 "tokens_per_day": the daily sync token quota is spent.
// Retrying within seconds is pointless (the x-ratelimit-reset-* headers come
// back as 0), so callers pause the work instead of failing it.
public class DoQuotaExhaustedException extends LlmApiException {

    public DoQuotaExhaustedException(String message) {
        super(429, message);
    }

    // Whether a 429 body names the daily token quota.
    public static boolean isDailyTokens(String body) {
        if (body == null) return false;
        var b = body.toLowerCase(java.util.Locale.ROOT);
        return b.contains("tokens_per_day") || b.contains("tokens per day");
    }
}
