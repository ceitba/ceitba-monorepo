package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Locale;

// Bound from auth.review-login.* in application.yml:
//   REVIEW_LOGIN_EMAIL=appreview@example.com
//   REVIEW_LOGIN_PASSWORD_HASH=$2a$12$...   (bcrypt, never the plain password)
//
// The App Store / Play review account (POST /v1/auth/review-login). Enabled
// only when BOTH are set; otherwise the endpoint answers 404. See
// docs/AUTH-AND-ROLES.md § App Store / Play review login.
@ConfigurationProperties(prefix = "auth.review-login")
public record ReviewLoginProperties(String email, String passwordHash) {

    public ReviewLoginProperties {
        email        = (email == null || email.isBlank()) ? null : email.trim().toLowerCase(Locale.ROOT);
        passwordHash = (passwordHash == null || passwordHash.isBlank()) ? null : passwordHash.trim();
    }

    public boolean enabled() {
        return email != null && passwordHash != null;
    }

    // True when `candidate` is the configured review email, whether or not the
    // login is currently enabled.
    public boolean isReviewEmail(String candidate) {
        return email != null && candidate != null && email.equalsIgnoreCase(candidate.trim());
    }
}
