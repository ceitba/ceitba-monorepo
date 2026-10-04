package org.ceitba.api.web.auth;

import jakarta.servlet.http.Cookie;
import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

class CookieOrHeaderBearerTokenResolverTest {

    private final CookieOrHeaderBearerTokenResolver resolver = resolver();

    private static CookieOrHeaderBearerTokenResolver resolver() {
        var cookie = new AuthProperties.Cookie("ceitba_session", null, null, null, null);
        return new CookieOrHeaderBearerTokenResolver(new AuthProperties(null, null, null, null, null, cookie, null));
    }

    private String resolve(String method, String path) {
        var req = new MockHttpServletRequest(method, "/api" + path);
        req.setContextPath("/api");
        req.setCookies(new Cookie("ceitba_session", "jwt"));
        return resolver.resolve(req);
    }

    @Test
    void staffMailAccountEndpointsUseTheSessionCookie() {
        assertThat(resolve("GET", "/v1/mail/accounts")).isEqualTo("jwt");
        assertThat(resolve("POST", "/v1/mail/accounts/ceitba/connect")).isEqualTo("jwt");
        assertThat(resolve("DELETE", "/v1/mail/accounts/123")).isEqualTo("jwt");
    }

    @Test
    void trackingAndOauthCallbackIgnoreTheSessionCookie() {
        assertThat(resolve("GET", "/v1/mail/o/abc.gif")).isNull();
        assertThat(resolve("GET", "/v1/mail/c/abc/def")).isNull();
        assertThat(resolve("GET", "/v1/mail/accounts/oauth/callback")).isNull();
    }
}
