package org.ceitba.api.service.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.TimeMeter;
import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.config.RateLimitProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.UUID;

// Per-user token buckets (bucket4j + Caffeine, like the per-IP
// RateLimitFilter) for rate-limit.user-rules.<rule>. In-memory, per instance.
// A rule missing from config, or rate-limit.enabled=false, means no limit.
@Component
public class UserRateLimiter {

    private final RateLimitProperties props;
    private final TimeMeter timeMeter;
    private final Cache<String, Bucket> buckets;

    @Autowired
    public UserRateLimiter(RateLimitProperties props) {
        this(props, TimeMeter.SYSTEM_MILLISECONDS);
    }

    UserRateLimiter(RateLimitProperties props, TimeMeter timeMeter) {
        this.props = props;
        this.timeMeter = timeMeter;
        Duration idle = props.userRules().values().stream()
            .map(RateLimitProperties.UserRule::period)
            .max(Duration::compareTo)
            .orElse(Duration.ofMinutes(1));
        this.buckets = Caffeine.newBuilder()
            .maximumSize(props.maxTrackedClients())
            .expireAfterAccess(idle)
            .build();
    }

    // Takes one token from the user's bucket for `rule`, or throws
    // RateLimitExceededException with the seconds until the next token.
    public void consume(String rule, UUID userId) {
        if (!props.enabled()) return;
        var config = props.userRules().get(rule);
        if (config == null) return;

        var bucket = buckets.get(rule + "|" + userId, k -> Bucket.builder()
            .addLimit(l -> l.capacity(config.capacity()).refillGreedy(config.capacity(), config.period()))
            .withCustomTimePrecision(timeMeter)
            .build());
        var probe = bucket.tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            throw new RateLimitExceededException(
                Math.max(1, (probe.getNanosToWaitForRefill() + 999_999_999L) / 1_000_000_000L));
        }
    }
}
