package org.ceitba.api.service.ratelimit;

import io.github.bucket4j.TimeMeter;
import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.config.RateLimitProperties;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UserRateLimiterTest {

    private static final UUID ALICE = UUID.randomUUID();
    private static final UUID BOB = UUID.randomUUID();

    private static final class FakeTime implements TimeMeter {
        long nanos;
        @Override public long currentTimeNanos() { return nanos; }
        @Override public boolean isWallClockBased() { return false; }
    }

    private static UserRateLimiter limiter(boolean enabled, FakeTime time) {
        var props = new RateLimitProperties(enabled, false, null, null,
            Map.of("uploads", new RateLimitProperties.UserRule(2, Duration.ofMinutes(1))));
        return new UserRateLimiter(props, time);
    }

    @Test
    void exhaustsPerUserAndReportsRetryAfter() {
        var time = new FakeTime();
        var limiter = limiter(true, time);
        limiter.consume("uploads", ALICE);
        limiter.consume("uploads", ALICE);

        assertThatThrownBy(() -> limiter.consume("uploads", ALICE))
            .isInstanceOf(RateLimitExceededException.class)
            .satisfies(e -> assertThat(((RateLimitExceededException) e).retryAfterSeconds()).isEqualTo(30));

        // Buckets are per user.
        assertThatCode(() -> limiter.consume("uploads", BOB)).doesNotThrowAnyException();

        // Greedy refill: one token back after period / capacity.
        time.nanos += TimeUnit.SECONDS.toNanos(30);
        assertThatCode(() -> limiter.consume("uploads", ALICE)).doesNotThrowAnyException();
    }

    @Test
    void disabledOrUnknownRuleNeverLimits() {
        var off = limiter(false, new FakeTime());
        var on = limiter(true, new FakeTime());
        for (int i = 0; i < 10; i++) {
            off.consume("uploads", ALICE);
            on.consume("other", ALICE);
        }
    }

    @Test
    void userRuleRejectsNonPositiveValues() {
        assertThatThrownBy(() -> new RateLimitProperties.UserRule(0, Duration.ofMinutes(1)))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RateLimitProperties.UserRule(1, Duration.ZERO))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
