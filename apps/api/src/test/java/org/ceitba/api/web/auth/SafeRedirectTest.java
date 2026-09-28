package org.ceitba.api.web.auth;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class SafeRedirectTest {

    @ParameterizedTest
    @ValueSource(strings = {
        "https://ceitba.org.ar",
        "https://ceitba.org.ar/",
        "https://ceitba.org.ar/manage?tab=1#x",
        "https://CEITBA.org.ar/manage",
        "https://ceitba.org.ar:443/manage",
        "http://localhost:3000/callback",
        "http://localhost:5175"
    })
    void acceptsAllowedOrigins(String uri) {
        assertThat(AuthController.isSafeRedirect(uri)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        " ",
        "https://ceitba.org.ar.evil.com",
        "https://ceitba.org.ar.evil.com/manage",
        "https://ceitba.org.ar@evil.com/",
        "https://user@ceitba.org.ar/",
        "https://ceitba.org.ar:8443/",
        "http://ceitba.org.ar/",
        "http://localhost:30001/",
        "http://localhost:3000.evil.com/",
        "https://ceitba.org.ar\\@evil.com",
        "//ceitba.org.ar/manage",
        "/manage",
        "javascript:alert(1)",
        "https://evil.com/?https://ceitba.org.ar"
    })
    void rejectsEverythingElse(String uri) {
        assertThat(AuthController.isSafeRedirect(uri)).isFalse();
    }

    @org.junit.jupiter.api.Test
    void rejectsNull() {
        assertThat(AuthController.isSafeRedirect(null)).isFalse();
    }
}
