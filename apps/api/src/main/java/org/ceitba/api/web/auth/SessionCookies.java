package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.springframework.http.ResponseCookie;

import java.time.Duration;
import java.util.List;

// Builds the web session cookie (auth.cookie.*) and the Set-Cookie values that
// expire it. Shared by every endpoint that signs the browser in or out, so
// logout and account deletion clear exactly the same cookies.
public final class SessionCookies {

    private SessionCookies() {}

    public static ResponseCookie issue(AuthProperties auth, String token) {
        var cfg = auth.cookie();
        int ttlDays = (auth.jwt() != null && auth.jwt().ttlDays() > 0) ? auth.jwt().ttlDays() : 7;
        var b = ResponseCookie.from(cfg.name(), token)
            .httpOnly(true)
            .secure(cfg.secure())
            .path(cfg.path())
            .sameSite(cfg.sameSite())
            .maxAge(Duration.ofDays(ttlDays));
        if (cfg.domain() != null && !cfg.domain().isBlank()) b.domain(cfg.domain());
        return b.build();
    }

    // Set-Cookie values that expire the session cookie. A browser can hold two
    // cookies with the session name: the Domain-scoped one we issue when
    // auth.cookie.domain is set, and a host-only one issued while it was unset.
    // A Set-Cookie only deletes the cookie whose Domain matches exactly, and
    // the resolver accepts either, so expire both or the user stays signed in.
    public static List<String> clearHeaders(AuthProperties auth) {
        var domain = auth.cookie().domain();
        if (domain == null || domain.isBlank()) return List.of(clear(auth, null).toString());
        return List.of(clear(auth, domain).toString(), clear(auth, null).toString());
    }

    private static ResponseCookie clear(AuthProperties auth, String domain) {
        var cfg = auth.cookie();
        var b = ResponseCookie.from(cfg.name(), "")
            .httpOnly(true)
            .secure(cfg.secure())
            .path(cfg.path())
            .sameSite(cfg.sameSite())
            .maxAge(Duration.ZERO);
        if (domain != null) b.domain(domain);
        return b.build();
    }
}
