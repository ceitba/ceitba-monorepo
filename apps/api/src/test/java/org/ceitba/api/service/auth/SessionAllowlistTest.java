package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.config.ReviewLoginProperties;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SessionAllowlistTest {

    static final AuthProperties AUTH = new AuthProperties(
        List.of("itba.edu.ar"), List.of("friend@gmail.com"), null, null, null, null, null);
    static final String HASH = "$2a$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

    @Test
    void admitsTheReviewEmailOnlyWhileReviewLoginIsEnabled() {
        var enabled = new SessionAllowlist(AUTH, new ReviewLoginProperties("AppReview@example.com", HASH));
        assertThat(enabled.admits("appreview@example.com")).isTrue();
        assertThat(enabled.admits("APPREVIEW@EXAMPLE.COM")).isTrue();
        assertThat(enabled.admits("other@example.com")).isFalse();
        assertThat(enabled.admits("alice@itba.edu.ar")).isTrue();
        assertThat(enabled.admits("friend@gmail.com")).isTrue();
        assertThat(enabled.admits(null)).isFalse();

        // Hash unset = review login disabled = the account's sessions stop working.
        var disabled = new SessionAllowlist(AUTH, new ReviewLoginProperties("appreview@example.com", null));
        assertThat(disabled.admits("appreview@example.com")).isFalse();
        assertThat(disabled.admits("alice@itba.edu.ar")).isTrue();
    }
}
