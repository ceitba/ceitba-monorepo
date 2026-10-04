package org.ceitba.api.service.mail;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class MailAccessTokenCacheTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-04T12:00:00Z"));
    private final AtomicInteger refreshes = new AtomicInteger();
    private final MailAccessTokenCache cache = new MailAccessTokenCache(refresh -> {
        int n = refreshes.incrementAndGet();
        return new GoogleMailOAuthClient.Tokens("access-" + n, null, null, null, 3600);
    }, clock);
    private final MailSenderAccountService.Credentials creds =
        new MailSenderAccountService.Credentials(1L, "ceitba@itba.edu.ar", "refresh", "enc-1");

    @Test
    void cachesUntilShortlyBeforeExpiryThenRefreshes() {
        assertThat(cache.get(creds)).isEqualTo("access-1");
        clock.advance(Duration.ofMinutes(50));
        assertThat(cache.get(creds)).isEqualTo("access-1");
        clock.advance(Duration.ofMinutes(9));   // inside the 2 min safety margin
        assertThat(cache.get(creds)).isEqualTo("access-2");
        assertThat(refreshes).hasValue(2);
    }

    @Test
    void invalidateAndReconnectionForceARefresh() {
        cache.get(creds);
        cache.invalidate(creds);
        assertThat(cache.get(creds)).isEqualTo("access-2");
        var reconnected = new MailSenderAccountService.Credentials(1L, "ceitba@itba.edu.ar", "new", "enc-2");
        assertThat(cache.get(reconnected)).isEqualTo("access-3");
    }
}
