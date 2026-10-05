package org.ceitba.api.web.kb.admin;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Custom OpenAI-compatible endpoints (docs/SUBJECT-WIKI-ADMIN.md, "Custom endpoints").
// The API key is write-only: responses only say hasKey (and keyReadable).
public final class KbEndpointDtos {

    private KbEndpointDtos() {}

    // hasKey && !keyReadable: AUTH_JWT_SECRET / KB_SECRETS_KEY changed since the
    // token was saved; the token must be entered again.
    public record Item(UUID id, String name, String baseUrl, boolean hasKey, boolean keyReadable, int maxConcurrency,
                       int timeoutSec, boolean enabled, long modelCount, OffsetDateTime createdAt,
                       OffsetDateTime updatedAt) {}

    public record TestResult(boolean ok, long latencyMs, List<String> models, String error) {}

    public record DiscoverResult(List<String> added, List<String> existing) {}

    public record Stats(int windowMinutes, long requests, long errors, Long p50Ms, Long p95Ms,
                        double outputTokensPerSec, int inFlight) {}
}
