package org.ceitba.api.service.mail;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

// Access tokens of the connected sender accounts, kept until shortly before
// they expire (they live ~1h). Keyed by account id AND stored token, so a
// reconnection (new refresh token) never reuses the old account's token.
public class MailAccessTokenCache {

    static final Duration SKEW = Duration.ofMinutes(2);

    private record Entry(String token, Instant expiresAt) {}

    private final java.util.function.Function<String, GoogleMailOAuthClient.Tokens> refresher;
    private final Clock clock;
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();

    // refresher: refresh token -> new access token (GoogleMailOAuthClient::refresh).
    public MailAccessTokenCache(java.util.function.Function<String, GoogleMailOAuthClient.Tokens> refresher,
                                Clock clock) {
        this.refresher = refresher;
        this.clock = clock;
    }

    // Throws GoogleMailOAuthClient.GoogleOAuthException when the refresh fails.
    public String get(MailSenderAccountService.Credentials c) {
        String key = key(c);
        Entry e = cache.get(key);
        Instant now = clock.instant();
        if (e != null && e.expiresAt().minus(SKEW).isAfter(now)) return e.token();
        var t = refresher.apply(c.refreshToken());
        cache.put(key, new Entry(t.accessToken(), now.plusSeconds(t.expiresIn())));
        return t.accessToken();
    }

    public void invalidate(MailSenderAccountService.Credentials c) {
        cache.remove(key(c));
    }

    private static String key(MailSenderAccountService.Credentials c) {
        return c.accountId() + ":" + c.tokenEnc().hashCode();
    }
}
