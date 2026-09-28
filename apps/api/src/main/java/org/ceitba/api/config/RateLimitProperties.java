package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;
import java.util.Map;

// Bound from rate-limit.* in application.yml. Per-client-IP token buckets,
// one bucket per (rule, IP). Rules are matched in declaration order against
// the request path inside the servlet context (i.e. without the /api prefix);
// the first rule whose `paths` match and whose `exclude-paths` don't wins;
// unmatched paths are not limited.
//
//   RATE_LIMIT_ENABLED=true
//   RATE_LIMIT_TRUST_FORWARDED_FOR=true   (behind Caddy; see RateLimitFilter)
//   RATE_LIMIT_AUTH_CAPACITY=20  RATE_LIMIT_AUTH_PERIOD=1m
//
// user-rules are per-authenticated-user quotas enforced in the service layer
// (service/ratelimit/UserRateLimiter), keyed by rule name, for operations
// where a per-IP limit would punish everyone behind the campus NAT.
@ConfigurationProperties(prefix = "rate-limit")
public record RateLimitProperties(
    Boolean enabled,
    Boolean trustForwardedFor,
    Long maxTrackedClients,
    Map<String, Rule> rules,
    Map<String, UserRule> userRules
) {
    // capacity requests per period, refilled greedily (smoothly).
    public record Rule(List<String> paths, List<String> excludePaths, long capacity, Duration period) {
        public Rule {
            paths        = paths != null ? paths : List.of();
            excludePaths = excludePaths != null ? excludePaths : List.of();
            if (capacity <= 0) throw new IllegalArgumentException("rate-limit rule capacity must be > 0");
            if (period == null || period.isZero() || period.isNegative()) {
                throw new IllegalArgumentException("rate-limit rule period must be > 0");
            }
        }
    }

    // capacity operations per period per user, refilled greedily.
    public record UserRule(long capacity, Duration period) {
        public UserRule {
            if (capacity <= 0) throw new IllegalArgumentException("rate-limit user rule capacity must be > 0");
            if (period == null || period.isZero() || period.isNegative()) {
                throw new IllegalArgumentException("rate-limit user rule period must be > 0");
            }
        }
    }

    public RateLimitProperties {
        enabled           = enabled != null ? enabled : Boolean.TRUE;
        trustForwardedFor = trustForwardedFor != null ? trustForwardedFor : Boolean.FALSE;
        maxTrackedClients = maxTrackedClients != null && maxTrackedClients > 0 ? maxTrackedClients : 100_000L;
        rules             = rules != null ? rules : Map.of();
        userRules         = userRules != null ? userRules : Map.of();
    }
}
