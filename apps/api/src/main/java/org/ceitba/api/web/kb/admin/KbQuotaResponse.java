package org.ceitba.api.web.kb.admin;

import java.time.OffsetDateTime;

// DigitalOcean rate-limit counters as last seen in response headers (docs
// ADMIN §quota). Every counter is null until DO answered once with it;
// observedAt = the most recent observation; stale = nothing seen in the last
// 10 minutes (GET ?refresh=true runs the free batch probe).
public record KbQuotaResponse(OffsetDateTime observedAt, Batch batch, Sync sync, boolean stale) {

    public record Counter(Long limit, Long remaining) {}

    public record Batch(Counter creationsPerHour, Counter createPerMinute, Counter requestsPerDay,
                        Counter statusChecksPerMinute) {}

    public record Sync(Counter tokensPerDay, Counter tokensPerMinute, Counter requestsPerMinute) {}
}
