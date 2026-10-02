package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class AuthControllerLogoutTest {

    private static AuthController controller(String cookieDomain) {
        var cookie = new AuthProperties.Cookie(null, cookieDomain, null, null, null);
        var props = new AuthProperties(null, null, null, null, null, cookie, null);
        // A body-less logout only depends on the auth properties.
        return new AuthController(null, null, null, null, null, null, null, props, null);
    }

    @Test
    void logoutExpiresBothDomainScopedAndHostOnlyCookies() {
        var res = controller("ceitba.org.ar").logout(null, null);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        var cookies = res.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertThat(cookies).hasSize(2);
        assertThat(cookies).allSatisfy(c -> assertThat(c)
            .startsWith("ceitba_session=;")
            .contains("Max-Age=0")
            .contains("Path=/"));
        assertThat(cookies).anySatisfy(c -> assertThat(c).contains("Domain=ceitba.org.ar"));
        assertThat(cookies).anySatisfy(c -> assertThat(c).doesNotContain("Domain="));
    }

    @Test
    void logoutWithoutConfiguredDomainSendsSingleHostOnlyClear() {
        var res = controller("").logout(null, null);

        var cookies = res.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertThat(cookies).hasSize(1);
        assertThat(cookies.get(0)).startsWith("ceitba_session=;").contains("Max-Age=0").doesNotContain("Domain=");
    }
}
