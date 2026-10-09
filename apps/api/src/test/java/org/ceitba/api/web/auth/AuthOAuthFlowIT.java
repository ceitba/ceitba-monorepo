package org.ceitba.api.web.auth;

import jakarta.servlet.http.Cookie;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.GoogleOAuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// End-to-end OAuth web flow with Google's token exchange stubbed out:
// /google must mint a signed state bound to an HttpOnly nonce cookie, and
// /callback must refuse to exchange the code unless both line up.
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "auth.frontend-url=https://ceitba.org.ar"
})
class AuthOAuthFlowIT {

    static final AtomicInteger EXCHANGES = new AtomicInteger();

    @TestConfiguration
    static class StubGoogle {
        @Bean
        @Primary
        GoogleOAuthService stubGoogleOAuth(AuthProperties auth) {
            return new GoogleOAuthService(auth) {
                @Override
                public IdTokenClaims exchangeCode(String code) {
                    EXCHANGES.incrementAndGet();
                    return new IdTokenClaims("google-sub-1", "alice@itba.edu.ar", "Alice",
                        null, true, "itba.edu.ar");
                }
            };
        }
    }

    @Autowired MockMvc mvc;
    @Autowired AuthProperties auth;

    @BeforeEach
    void reset() {
        EXCHANGES.set(0);
    }

    @Test
    void googleLogin_setsHttpOnlyStateCookie_andSignedState() throws Exception {
        var res = startLogin("https://ceitba.org.ar/manage");

        var cookie = res.getResponse().getCookie(AuthController.STATE_COOKIE);
        assertThat(cookie).isNotNull();
        assertThat(cookie.isHttpOnly()).isTrue();
        assertThat(cookie.getValue()).isNotBlank();
        assertThat(res.getResponse().getHeader(HttpHeaders.SET_COOKIE)).contains("SameSite=Lax");

        String state = stateOf(res);
        assertThat(state).contains(".");
        // The state is not the old plain-base64 redirect target.
        assertThat(state).isNotEqualTo(Base64.getUrlEncoder().withoutPadding()
            .encodeToString("https://ceitba.org.ar/manage".getBytes()));
    }

    @Test
    void fullFlow_withMatchingCookie_logsInAndRedirectsToTarget() throws Exception {
        var start = startLogin("https://ceitba.org.ar/manage?tab=2");

        var res = mvc.perform(get("/v1/auth/callback")
                .param("code", "good-code")
                .param("state", stateOf(start))
                .cookie(start.getResponse().getCookie(AuthController.STATE_COOKIE)))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar/manage?tab=2");
        assertThat(res.getResponse().getCookie(auth.cookie().name())).isNotNull();
        assertThat(res.getResponse().getCookie(auth.cookie().name()).getValue()).isNotBlank();
        assertThat(EXCHANGES.get()).isEqualTo(1);
    }

    @Test
    void callback_withoutStateCookie_isRejectedBeforeCodeExchange() throws Exception {
        var start = startLogin("https://ceitba.org.ar/manage");

        var res = mvc.perform(get("/v1/auth/callback")
                .param("code", "good-code")
                .param("state", stateOf(start)))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar?error=invalid_state");
        assertThat(res.getResponse().getCookie(auth.cookie().name())).isNull();
        assertThat(EXCHANGES.get()).isZero();
    }

    @Test
    void callback_withAnotherBrowsersCookie_isRejected() throws Exception {
        var victim = startLogin("https://ceitba.org.ar/manage");
        var attacker = startLogin("https://ceitba.org.ar/manage");

        var res = mvc.perform(get("/v1/auth/callback")
                .param("code", "good-code")
                .param("state", stateOf(attacker))
                .cookie(victim.getResponse().getCookie(AuthController.STATE_COOKIE)))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).endsWith("error=invalid_state");
        assertThat(EXCHANGES.get()).isZero();
    }

    @Test
    void callback_withLegacyUnsignedState_isRejected() throws Exception {
        String legacy = Base64.getUrlEncoder().withoutPadding().encodeToString("https://evil.com".getBytes());

        var res = mvc.perform(get("/v1/auth/callback")
                .param("code", "good-code")
                .param("state", legacy)
                .cookie(new Cookie(AuthController.STATE_COOKIE, "whatever")))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar?error=invalid_state");
        assertThat(EXCHANGES.get()).isZero();
    }

    @Test
    void googleLogin_lookalikeRedirect_fallsBackToFrontend() throws Exception {
        var start = startLogin("https://ceitba.org.ar.evil.com/steal");

        var res = mvc.perform(get("/v1/auth/callback")
                .param("code", "good-code")
                .param("state", stateOf(start))
                .cookie(start.getResponse().getCookie(AuthController.STATE_COOKIE)))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar");
    }

    // User clicked "Cancel" on Google's consent screen: Google sends
    // ?error=access_denied&state=... and no code. Land on the SPA, not a 400.
    @Test
    void callback_whenUserCancelsConsent_redirectsToTargetWithAccessDenied() throws Exception {
        var start = startLogin("https://ceitba.org.ar/manage");

        var res = mvc.perform(get("/v1/auth/callback")
                .param("error", "access_denied")
                .param("state", stateOf(start))
                .cookie(start.getResponse().getCookie(AuthController.STATE_COOKIE)))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar/manage?error=access_denied");
        assertThat(res.getResponse().getCookie(auth.cookie().name())).isNull();
        assertThat(res.getResponse().getCookie(AuthController.STATE_COOKIE).getMaxAge()).isZero();
        assertThat(EXCHANGES.get()).isZero();
    }

    // Other Google errors are not echoed back verbatim.
    @Test
    void callback_withOtherGoogleErrorOrNoCode_redirectsWithAuthFailed() throws Exception {
        var start = startLogin("https://ceitba.org.ar/manage");
        var cookie = start.getResponse().getCookie(AuthController.STATE_COOKIE);

        var withError = mvc.perform(get("/v1/auth/callback")
                .param("error", "<script>").param("state", stateOf(start)).cookie(cookie))
            .andExpect(status().isFound()).andReturn();
        assertThat(withError.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar/manage?error=auth_failed");

        var noCode = mvc.perform(get("/v1/auth/callback").param("state", stateOf(start)).cookie(cookie))
            .andExpect(status().isFound()).andReturn();
        assertThat(noCode.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar/manage?error=auth_failed");
        assertThat(EXCHANGES.get()).isZero();
    }

    // The state is still verified: a cancel with a forged/missing state goes
    // to FRONTEND_URL, never to a target taken from the request.
    @Test
    void callback_cancelWithoutValidState_isInvalidState() throws Exception {
        var res = mvc.perform(get("/v1/auth/callback").param("error", "access_denied"))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(res.getResponse().getRedirectedUrl()).isEqualTo("https://ceitba.org.ar?error=invalid_state");
    }

    @Test
    void logout_isPostOnly() throws Exception {
        mvc.perform(post("/v1/auth/logout")).andExpect(status().isNoContent());
        // GET is no longer permitAll: unauthenticated GET gets 401.
        mvc.perform(get("/v1/auth/logout")).andExpect(status().isUnauthorized());
    }

    private MvcResult startLogin(String redirectUri) throws Exception {
        return mvc.perform(get("/v1/auth/google").param("redirect_uri", redirectUri))
            .andExpect(status().isFound())
            .andReturn();
    }

    private static String stateOf(MvcResult res) {
        var location = URI.create(res.getResponse().getRedirectedUrl());
        return UriComponentsBuilder.fromUri(location).build().getQueryParams().getFirst("state");
    }
}
