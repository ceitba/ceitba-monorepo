package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;

// Bound from auth.* in application.yml. Override at runtime via env:
//   AUTH_ALLOWED_DOMAINS=itba.edu.ar,alu.itba.edu.ar
//   AUTH_ALLOWED_EMAILS=admin@gmail.com,founder@gmail.com
//   AUTH_SYNC_API_KEY=...
//   GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...  GOOGLE_REDIRECT_URI=...
//   AUTH_GOOGLE_MOBILE_AUDIENCES=<web client id>,<ios client id>
//   AUTH_JWT_SECRET=<base64-encoded 32+ byte secret>  AUTH_JWT_TTL_DAYS=7
//   AUTH_JWT_ISSUER=https://ceitba.org.ar/api  AUTH_JWT_ENFORCE_ISS_AUD=false
//   AUTH_MOBILE_ACCESS_TTL=15m  AUTH_REFRESH_TTL=60d  AUTH_REFRESH_REUSE_GRACE=60s
//   AUTH_COOKIE_NAME=ceitba_session  AUTH_COOKIE_DOMAIN=ceitba.org.ar
//   AUTH_COOKIE_SECURE=true  AUTH_COOKIE_SAMESITE=Lax  AUTH_COOKIE_PATH=/
//   FRONTEND_URL=https://ceitba.org.ar
@ConfigurationProperties(prefix = "auth")
public record AuthProperties(
    List<String> allowedDomains,
    List<String> allowedEmails,
    String syncApiKey,
    Google google,
    Jwt jwt,
    Cookie cookie,
    String frontendUrl
) {
    // mobileAudiences: OAuth client IDs a Google ID token presented to
    // POST /v1/auth/google/mobile may be issued for (its `aud`). Usually the
    // web client ID the app passes as serverClientId, plus the iOS client ID.
    // Empty disables the mobile login endpoint.
    public record Google(String clientId, String clientSecret, String redirectUri,
                         List<String> mobileAudiences) {
        public Google {
            mobileAudiences = mobileAudiences == null ? List.of()
                : mobileAudiences.stream().filter(a -> a != null && !a.isBlank()).map(String::trim).toList();
        }
    }

    // ttlDays:          web session JWT (cookie) lifetime.
    // issuer:           `iss` put in (and, once enforced, required on) our JWTs.
    // enforceIssuerAudience: false = phase-in; iss/aud are validated only when
    //                   present so pre-B1 cookies without them keep working.
    // mobileAccessTtl:  access-token lifetime for the mobile token endpoints.
    // refreshTtl:       refresh-token lifetime (sliding: each rotation renews it).
    // refreshReuseGrace: how long after a rotation the previous token may be
    //                   presented again (the rotation response was lost) and
    //                   get a new successor instead of revoking the family.
    //                   Zero disables the grace window.
    public record Jwt(String secret, int ttlDays, String issuer, Boolean enforceIssuerAudience,
                      Duration mobileAccessTtl, Duration refreshTtl, Duration refreshReuseGrace) {
        public static final String AUDIENCE = "ceitba-api";

        public Jwt {
            issuer = (issuer == null || issuer.isBlank()) ? "https://ceitba.org.ar/api" : issuer;
            enforceIssuerAudience = Boolean.TRUE.equals(enforceIssuerAudience);
            mobileAccessTtl = positiveOr(mobileAccessTtl, Duration.ofMinutes(15));
            refreshTtl      = positiveOr(refreshTtl, Duration.ofDays(60));
            refreshReuseGrace = refreshReuseGrace == null ? Duration.ofSeconds(60)
                : (refreshReuseGrace.isNegative() ? Duration.ZERO : refreshReuseGrace);
        }

        private static Duration positiveOr(Duration d, Duration fallback) {
            return (d == null || d.isZero() || d.isNegative()) ? fallback : d;
        }
    }

    // Session cookie used to carry the issued JWT to all SPAs sharing the
    // ceitba.org.ar origin. HttpOnly is forced in code; the rest is configurable
    // because local-dev flips Secure off and `SameSite=None` may be needed for
    // tunnelled HTTPS dev environments.
    public record Cookie(String name, String domain, Boolean secure, String sameSite, String path) {
        public Cookie {
            name     = (name == null || name.isBlank()) ? "ceitba_session" : name;
            secure   = secure == null ? Boolean.TRUE : secure;
            sameSite = (sameSite == null || sameSite.isBlank()) ? "Lax" : sameSite;
            path     = (path == null || path.isBlank()) ? "/" : path;
        }
    }

    public AuthProperties {
        allowedDomains = allowedDomains != null ? allowedDomains : List.of();
        allowedEmails  = allowedEmails  != null ? allowedEmails  : List.of();
        frontendUrl = frontendUrl != null ? frontendUrl : "http://localhost:3000";
        if (cookie == null) cookie = new Cookie(null, null, null, null, null);
    }

    public boolean admits(String email) {
        if (email == null) return false;
        var lower = email.toLowerCase();
        for (var d : allowedDomains) {
            if (lower.endsWith("@" + d.toLowerCase())) return true;
        }
        for (var e : allowedEmails) {
            if (lower.equals(e.toLowerCase())) return true;
        }
        return false;
    }
}
