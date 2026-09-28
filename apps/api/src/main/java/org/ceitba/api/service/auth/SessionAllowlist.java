package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.config.ReviewLoginProperties;
import org.springframework.stereotype.Component;

// Who may use a session (our JWT / refresh token) once it has been issued:
// the email allowlist (auth.allowed-domains + auth.allowed-emails) plus the
// App Store / Play review account while review login is enabled.
//
// Deliberately NOT used at sign-in: Google logins keep checking
// AuthProperties.admits directly, so the review email can only get a session
// through POST /v1/auth/review-login. Disabling review login (unsetting its
// env vars) makes the review account's JWTs and refresh tokens stop working.
@Component
public class SessionAllowlist {

    private final AuthProperties auth;
    private final ReviewLoginProperties reviewLogin;

    public SessionAllowlist(AuthProperties auth, ReviewLoginProperties reviewLogin) {
        this.auth        = auth;
        this.reviewLogin = reviewLogin;
    }

    public boolean admits(String email) {
        if (email == null) return false;
        return auth.admits(email) || (reviewLogin.enabled() && reviewLogin.isReviewEmail(email));
    }
}
