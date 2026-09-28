package org.ceitba.api.web.ratelimit;

import io.github.bucket4j.TimeMeter;
import org.ceitba.api.config.RateLimitProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitFilterTest {

    // Manually advanced clock so refill behaviour is deterministic.
    static final class FakeTime implements TimeMeter {
        final AtomicLong nanos = new AtomicLong();
        @Override public long currentTimeNanos() { return nanos.get(); }
        @Override public boolean isWallClockBased() { return false; }
        void advance(Duration d) { nanos.addAndGet(d.toNanos()); }
    }

    private final FakeTime time = new FakeTime();

    private RateLimitFilter filter(boolean enabled, boolean trustXff, long capacity) {
        var rules = new LinkedHashMap<String, RateLimitProperties.Rule>();
        rules.put("auth", new RateLimitProperties.Rule(
            List.of("/v1/auth/**"), List.of("/v1/auth/me"), capacity, Duration.ofMinutes(1)));
        return new RateLimitFilter(new RateLimitProperties(enabled, trustXff, null, rules, null), time);
    }

    private static MockHttpServletRequest req(String path, String ip) {
        var r = new MockHttpServletRequest("GET", "/api" + path);
        r.setContextPath("/api");
        r.setRemoteAddr(ip);
        return r;
    }

    private static MockHttpServletResponse call(RateLimitFilter f, MockHttpServletRequest r) throws Exception {
        var res = new MockHttpServletResponse();
        f.doFilter(r, res, new MockFilterChain());
        return res;
    }

    @Test
    void allowsUpToCapacity_thenReturns429WithRetryAfter() throws Exception {
        var f = filter(true, false, 3);

        for (int i = 0; i < 3; i++) {
            var ok = call(f, req("/v1/auth/google", "1.1.1.1"));
            assertThat(ok.getStatus()).isEqualTo(200);
            assertThat(ok.getHeader("X-RateLimit-Remaining")).isEqualTo(Integer.toString(2 - i));
        }
        var limited = call(f, req("/v1/auth/google", "1.1.1.1"));

        assertThat(limited.getStatus()).isEqualTo(429);
        assertThat(limited.getHeader("Retry-After")).isEqualTo("20"); // 60s / 3 tokens
        assertThat(limited.getContentType()).isEqualTo("application/json");
        assertThat(limited.getContentAsString()).contains("\"error\":\"TooManyRequests\"")
            .contains("\"path\":\"/api/v1/auth/google\"");
    }

    @Test
    void refillsOverTime() throws Exception {
        var f = filter(true, false, 2);
        call(f, req("/v1/auth/callback", "1.1.1.1"));
        call(f, req("/v1/auth/callback", "1.1.1.1"));
        assertThat(call(f, req("/v1/auth/callback", "1.1.1.1")).getStatus()).isEqualTo(429);

        time.advance(Duration.ofSeconds(30)); // one token back (2 per minute)

        assertThat(call(f, req("/v1/auth/callback", "1.1.1.1")).getStatus()).isEqualTo(200);
        assertThat(call(f, req("/v1/auth/callback", "1.1.1.1")).getStatus()).isEqualTo(429);
    }

    @Test
    void bucketsArePerIp() throws Exception {
        var f = filter(true, false, 1);
        assertThat(call(f, req("/v1/auth/google", "1.1.1.1")).getStatus()).isEqualTo(200);
        assertThat(call(f, req("/v1/auth/google", "1.1.1.1")).getStatus()).isEqualTo(429);
        assertThat(call(f, req("/v1/auth/google", "2.2.2.2")).getStatus()).isEqualTo(200);
    }

    @Test
    void unmatchedAndExcludedPathsAreNotLimited() throws Exception {
        var f = filter(true, false, 1);
        for (int i = 0; i < 5; i++) {
            assertThat(call(f, req("/v1/careers", "1.1.1.1")).getStatus()).isEqualTo(200);
            assertThat(call(f, req("/v1/auth/me", "1.1.1.1")).getStatus()).isEqualTo(200);
        }
        assertThat(call(f, req("/v1/careers", "1.1.1.1")).getHeader("X-RateLimit-Limit")).isNull();
    }

    @Test
    void disabled_neverLimits() throws Exception {
        var f = filter(false, false, 1);
        for (int i = 0; i < 5; i++) {
            assertThat(call(f, req("/v1/auth/google", "1.1.1.1")).getStatus()).isEqualTo(200);
        }
    }

    @Test
    void corsPreflightIsNotCounted() throws Exception {
        var f = filter(true, false, 1);
        var preflight = req("/v1/auth/google", "1.1.1.1");
        preflight.setMethod("OPTIONS");
        call(f, preflight);
        call(f, preflight);

        assertThat(call(f, req("/v1/auth/google", "1.1.1.1")).getStatus()).isEqualTo(200);
    }

    @Test
    void trustedXff_usesRightMostEntry_soSpoofedLeftEntriesDontHelp() throws Exception {
        var f = filter(true, true, 1);
        var a = req("/v1/auth/google", "10.0.0.2"); // Caddy's address
        a.addHeader("X-Forwarded-For", "6.6.6.1, 9.9.9.9");
        var b = req("/v1/auth/google", "10.0.0.2");
        b.addHeader("X-Forwarded-For", "6.6.6.2, 9.9.9.9");

        assertThat(call(f, a).getStatus()).isEqualTo(200);
        assertThat(call(f, b).getStatus()).isEqualTo(429);
        assertThat(f.clientIp(a)).isEqualTo("9.9.9.9");
    }

    @Test
    void untrustedXff_isIgnored() throws Exception {
        var f = filter(true, false, 1);
        var a = req("/v1/auth/google", "5.5.5.5");
        a.addHeader("X-Forwarded-For", "1.2.3.4");

        assertThat(f.clientIp(a)).isEqualTo("5.5.5.5");
    }

    @Test
    void retryAfterRoundsUp() throws Exception {
        var f = filter(true, false, 1);
        call(f, req("/v1/auth/google", "1.1.1.1"));
        time.advance(Duration.ofMillis(TimeUnit.SECONDS.toMillis(59) + 500));

        assertThat(call(f, req("/v1/auth/google", "1.1.1.1")).getHeader("Retry-After")).isEqualTo("1");
    }

    @Test
    void trustedXff_isIgnoredWhenThePeerIsPublic_soDirectCallersCantSpoofIt() throws Exception {
        var f = filter(true, true, 1);
        var a = req("/v1/auth/google", "203.0.113.7"); // skipped the proxy
        a.addHeader("X-Forwarded-For", "1.1.1.1");
        var b = req("/v1/auth/google", "203.0.113.7");
        b.addHeader("X-Forwarded-For", "2.2.2.2");

        assertThat(f.clientIp(a)).isEqualTo("203.0.113.7");
        assertThat(call(f, a).getStatus()).isEqualTo(200);
        assertThat(call(f, b).getStatus()).isEqualTo(429);
    }

    @Test
    void privatePeerDetection() {
        assertThat(RateLimitFilter.isPrivatePeer("127.0.0.1")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("10.1.2.3")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("172.18.0.5")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("192.168.1.1")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("::1")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("fd00::1")).isTrue();
        assertThat(RateLimitFilter.isPrivatePeer("8.8.8.8")).isFalse();
        assertThat(RateLimitFilter.isPrivatePeer("2001:db8::1")).isFalse();
        assertThat(RateLimitFilter.isPrivatePeer("example.com")).isFalse();
        assertThat(RateLimitFilter.isPrivatePeer(null)).isFalse();
    }

    @Test
    void ipv6ClientsShareABucketPerSlash64() throws Exception {
        var f = filter(true, false, 1);
        assertThat(call(f, req("/v1/auth/google", "2001:db8:1:2::1")).getStatus()).isEqualTo(200);
        // Same /64, different interface id: rotating addresses does not help.
        assertThat(call(f, req("/v1/auth/google", "2001:db8:1:2:abcd::99")).getStatus()).isEqualTo(429);
        // Another /64 is another client.
        assertThat(call(f, req("/v1/auth/google", "2001:db8:1:3::1")).getStatus()).isEqualTo(200);
    }

    @Test
    void ipv6ForwardedClientsShareABucketPerSlash64() throws Exception {
        var f = filter(true, true, 1);
        var a = req("/v1/auth/google", "10.0.0.2");
        a.addHeader("X-Forwarded-For", "2001:db8:aa:bb::1");
        var b = req("/v1/auth/google", "10.0.0.2");
        b.addHeader("X-Forwarded-For", "2001:db8:aa:bb:ffff::2");

        assertThat(call(f, a).getStatus()).isEqualTo(200);
        assertThat(call(f, b).getStatus()).isEqualTo(429);
    }

    @Test
    void clientKeyNormalization() {
        assertThat(RateLimitFilter.clientKey("1.2.3.4")).isEqualTo("1.2.3.4");
        assertThat(RateLimitFilter.clientKey("2001:db8:1:2:3:4:5:6")).isEqualTo("2001:db8:1:2:0:0:0:0/64");
        assertThat(RateLimitFilter.clientKey("[2001:db8:1:2::7]")).isEqualTo("2001:db8:1:2:0:0:0:0/64");
        assertThat(RateLimitFilter.clientKey("fe80::1%eth0")).isEqualTo("fe80:0:0:0:0:0:0:0/64");
        assertThat(RateLimitFilter.clientKey("::ffff:1.2.3.4")).isEqualTo("1.2.3.4");
        assertThat(RateLimitFilter.clientKey("not:an-ip")).isEqualTo("not:an-ip");
        assertThat(RateLimitFilter.clientKey(null)).isNull();
    }
}
