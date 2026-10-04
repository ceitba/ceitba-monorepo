package org.ceitba.api.external.llm;

import java.net.http.HttpHeaders;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

// Latest DigitalOcean rate-limit counters, read from the x-ratelimit-limit-* /
// x-ratelimit-remaining-* headers of every DO response (429s included), kept
// in memory only. Keys are the header suffix: batch-creations-per-hour,
// batch-create-per-minute, batch-requests-per-day, batch-status-checks-per-minute,
// tokens-per-day, tokens-per-minute, requests. x-ratelimit-reset-* is a Unix
// time when DO knows it (0 otherwise). DO has no usage endpoint; a POST
// /v1/batches with a nonexistent file_id answers with the batch headers: the
// probe behind refreshBatchQuota().
//
// Rejected creation attempts count against batch-creations-per-hour: retrying
// every 10 minutes (6/h against a limit of 5) kept the quota at 0 for hours.
// So once the quota is 0 nothing calls POST /v1/batches (not even the probe)
// until DO's reset time, or an hour after the observation when DO gives none.
public class DoQuotaTracker {

    public static final String BATCH_CREATIONS_HOUR = "batch-creations-per-hour";
    public static final String TOKENS_DAY = "tokens-per-day";

    // Sync daily-token pauses re-check this often (no reset header to rely on).
    public static final Duration DAILY_RETRY = Duration.ofMinutes(30);
    static final Duration BATCH_WINDOW = Duration.ofMinutes(60);
    static final Duration RESET_MARGIN = Duration.ofSeconds(30);
    static final Duration PROBE_EVERY = Duration.ofMinutes(1);

    // resetAt: DO's x-ratelimit-reset-* time, null when DO sent 0 or nothing.
    public record Counter(Long limit, Long remaining, OffsetDateTime observedAt, OffsetDateTime resetAt) {

        public Counter(Long limit, Long remaining, OffsetDateTime observedAt) {
            this(limit, remaining, observedAt, null);
        }
    }

    public record BatchWait(OffsetDateTime until, String reason) {}

    private final Clock clock;
    private final Map<String, Counter> counters = new ConcurrentHashMap<>();
    private final AtomicReference<OffsetDateTime> observedAt = new AtomicReference<>();
    private final AtomicReference<Long> retryAfterSec = new AtomicReference<>();
    private volatile OffsetDateTime lastProbe;
    private volatile Runnable probe = () -> {};

    public DoQuotaTracker(Clock clock) {
        this.clock = clock;
    }

    // The batch client's free probe; the config binds it.
    public void bindProbe(Runnable probe) {
        this.probe = probe;
    }

    public void observe(HttpHeaders headers) {
        observe(headers.map());
    }

    // Header names are matched case-insensitively.
    public void observe(Map<String, ? extends Iterable<String>> headers) {
        var now = OffsetDateTime.now(clock);
        var limits = new java.util.HashMap<String, Long>();
        var remaining = new java.util.HashMap<String, Long>();
        var resets = new java.util.HashMap<String, Long>();
        boolean any = false;
        for (var e : headers.entrySet()) {
            var name = e.getKey() == null ? "" : e.getKey().toLowerCase(java.util.Locale.ROOT);
            var value = first(e.getValue());
            if (value == null) continue;
            if (name.startsWith("x-ratelimit-limit-")) {
                limits.put(name.substring("x-ratelimit-limit-".length()), number(value));
            } else if (name.startsWith("x-ratelimit-remaining-")) {
                remaining.put(name.substring("x-ratelimit-remaining-".length()), number(value));
            } else if (name.startsWith("x-ratelimit-reset-")) {
                resets.put(name.substring("x-ratelimit-reset-".length()), number(value));
            } else if (name.equals("retry-after")) {
                var s = number(value);
                if (s != null) retryAfterSec.set(s);
            }
        }
        var keys = new java.util.HashSet<>(limits.keySet());
        keys.addAll(remaining.keySet());
        for (var k : keys) {
            var prev = counters.get(k);
            var limit = limits.get(k) != null ? limits.get(k) : prev == null ? null : prev.limit();
            var rem = remaining.get(k) != null ? remaining.get(k) : prev == null ? null : prev.remaining();
            var r = resets.get(k);
            var resetAt = r == null || r <= 0 ? null
                : OffsetDateTime.ofInstant(java.time.Instant.ofEpochSecond(r), java.time.ZoneOffset.UTC);
            counters.put(k, new Counter(limit, rem, now, resetAt));
            any = true;
        }
        if (any) observedAt.set(now);
    }

    private static String first(Iterable<String> values) {
        for (var v : values) return v;
        return null;
    }

    private static Long number(String v) {
        try {
            return Long.parseLong(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public Optional<Counter> counter(String key) {
        return Optional.ofNullable(counters.get(key));
    }

    public Optional<OffsetDateTime> lastObservedAt() {
        return Optional.ofNullable(observedAt.get());
    }

    public Optional<Long> lastRetryAfterSeconds() {
        return Optional.ofNullable(retryAfterSec.get());
    }

    // Batch probe; at most once a minute, never throws, and never while a zero
    // quota is waiting for its reset (a refused attempt would extend it).
    public synchronized void refreshBatchQuota() {
        var now = OffsetDateTime.now(clock);
        if (lastProbe != null && now.isBefore(lastProbe.plus(PROBE_EVERY))) return;
        if (zeroUntil().map(now::isBefore).orElse(false)) return;
        lastProbe = now;
        try {
            probe.run();
        } catch (RuntimeException ignored) {
            // a failed probe leaves the snapshot as it was
        }
    }

    // Present while the last snapshot says no batch creation is left: until
    // DO's reset time (plus a margin), or observedAt + 60 min when DO gave
    // none. Nothing calls DO before then; afterwards one real attempt is made.
    public Optional<BatchWait> batchCreationWait() {
        var c = counters.get(BATCH_CREATIONS_HOUR);
        var until = zeroUntil().orElse(null);
        if (c == null || until == null || !OffsetDateTime.now(clock).isBefore(until)) return Optional.empty();
        return Optional.of(new BatchWait(until, "Esperando cupo de lotes de DigitalOcean: 0/"
            + (c.limit() == null ? "?" : c.limit()) + " esta hora"));
    }

    // When a zero hourly batch quota frees up, if the last snapshot is zero.
    Optional<OffsetDateTime> zeroUntil() {
        var c = counters.get(BATCH_CREATIONS_HOUR);
        if (c == null || c.remaining() == null || c.remaining() > 0) return Optional.empty();
        var until = c.resetAt() != null && c.resetAt().isAfter(c.observedAt())
            ? c.resetAt().plus(RESET_MARGIN) : c.observedAt().plus(BATCH_WINDOW);
        return Optional.of(until);
    }

    // The snapshot (under 30 min old) shows fewer daily tokens left than the
    // next request needs. An older snapshot is ignored: the bucket refills and
    // only a real request refreshes it.
    public boolean dailyTokensShort(long estimatedTokens) {
        var c = counters.get(TOKENS_DAY);
        if (c == null || c.remaining() == null) return false;
        if (!OffsetDateTime.now(clock).isBefore(c.observedAt().plus(DAILY_RETRY))) return false;
        return c.remaining() < estimatedTokens;
    }
}
