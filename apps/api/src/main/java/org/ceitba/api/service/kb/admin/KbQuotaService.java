package org.ceitba.api.service.kb.admin;

import org.ceitba.api.external.llm.DoQuotaTracker;
import org.ceitba.api.web.kb.admin.KbQuotaResponse;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;

// The admin panel's view of DoQuotaTracker.
@Service
public class KbQuotaService {

    static final Duration STALE_AFTER = Duration.ofMinutes(10);

    private final DoQuotaTracker tracker;
    private final Clock clock;

    public KbQuotaService(DoQuotaTracker tracker, Clock clock) {
        this.tracker = tracker;
        this.clock = clock;
    }

    // refresh is accepted but no longer probes DO: the "free" probe spent one
    // of the 5 hourly batch creations. The snapshot comes from real calls.
    public KbQuotaResponse get(boolean refresh) {
        var at = tracker.lastObservedAt().orElse(null);
        boolean stale = at == null || OffsetDateTime.now(clock).isAfter(at.plus(STALE_AFTER));
        return new KbQuotaResponse(at,
            new KbQuotaResponse.Batch(c("batch-creations-per-hour"), c("batch-create-per-minute"),
                c("batch-requests-per-day"), c("batch-status-checks-per-minute")),
            new KbQuotaResponse.Sync(c("tokens-per-day"), c("tokens-per-minute"), c("requests")), stale);
    }

    private KbQuotaResponse.Counter c(String key) {
        return tracker.counter(key).map(x -> new KbQuotaResponse.Counter(x.limit(), x.remaining())).orElse(null);
    }
}
