package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Locale;
import java.util.regex.Pattern;

// Bound from auth.review-login.* in application.yml:
//   REVIEW_LOGIN_EMAIL=appreview@example.com
//   REVIEW_LOGIN_PASSWORD_HASH='$2a$12$...'   (bcrypt, never the plain password;
//                                             single quotes, or compose expands the `$`)
//
// The App Store / Play review account (POST /v1/auth/review-login). Enabled
// only when BOTH are set and the hash is a well-formed bcrypt string;
// otherwise the endpoint answers 404. A bad value never fails startup: it is
// reported once by ReviewLoginService and treated as disabled (MISCONFIGURED).
// See docs/AUTH-AND-ROLES.md § App Store / Play review login.
@ConfigurationProperties(prefix = "auth.review-login")
public record ReviewLoginProperties(String email, String passwordHash) {

    public enum Status { DISABLED, ENABLED, MISCONFIGURED }

    // $2a$ / $2b$ / $2y$, cost 04-31, 22 chars of salt + 31 of hash = 60 chars.
    private static final Pattern BCRYPT =
        Pattern.compile("^\\$2[aby]\\$(0[4-9]|[12]\\d|3[01])\\$[./0-9A-Za-z]{53}$");

    public ReviewLoginProperties {
        // Only surrounding whitespace is trimmed; anything else is kept as-is and
        // must match the bcrypt format exactly.
        email        = (email == null || email.isBlank()) ? null : email.trim().toLowerCase(Locale.ROOT);
        passwordHash = (passwordHash == null || passwordHash.isBlank()) ? null : passwordHash.trim();
    }

    public Status status() {
        if (email == null && passwordHash == null) return Status.DISABLED;
        if (email == null || passwordHash == null) return Status.MISCONFIGURED;
        return BCRYPT.matcher(passwordHash).matches() ? Status.ENABLED : Status.MISCONFIGURED;
    }

    public boolean enabled() {
        return status() == Status.ENABLED;
    }

    // bcrypt cost of a well-formed hash, else `fallback`.
    public int bcryptCost(int fallback) {
        if (passwordHash == null) return fallback;
        var m = BCRYPT.matcher(passwordHash);
        return m.matches() ? Integer.parseInt(m.group(1)) : fallback;
    }

    // True when `candidate` is the configured review email, whether or not the
    // login is currently enabled.
    public boolean isReviewEmail(String candidate) {
        return email != null && candidate != null && email.equalsIgnoreCase(candidate.trim());
    }
}
