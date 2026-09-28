package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class OAuthStateServiceTest {

    private static final String SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    private static final Instant T0 = Instant.parse("2026-05-01T12:00:00Z");

    private static OAuthStateService service(String secret, Instant now) {
        var props = new AuthProperties(null, null, null, null,
            new AuthProperties.Jwt(secret, 1, null, null, null, null, null), null, null);
        return new OAuthStateService(props, Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    void roundTrip_returnsTarget() {
        var svc = service(SECRET, T0);
        var issued = svc.issue("https://ceitba.org.ar/manage?x=1|2");

        assertThat(svc.verify(issued.state(), issued.nonce()))
            .contains("https://ceitba.org.ar/manage?x=1|2");
    }

    @Test
    void statesAreRandom() {
        var svc = service(SECRET, T0);
        assertThat(svc.issue("https://ceitba.org.ar").state())
            .isNotEqualTo(svc.issue("https://ceitba.org.ar").state());
    }

    @Test
    void rejectsMissingOrWrongNonce() {
        var svc = service(SECRET, T0);
        var issued = svc.issue("https://ceitba.org.ar");
        var other = svc.issue("https://ceitba.org.ar");

        assertThat(svc.verify(issued.state(), null)).isEmpty();
        assertThat(svc.verify(issued.state(), "")).isEmpty();
        assertThat(svc.verify(issued.state(), other.nonce())).isEmpty();
    }

    @Test
    void rejectsExpiredState() {
        var issued = service(SECRET, T0).issue("https://ceitba.org.ar");
        var later = service(SECRET, T0.plus(OAuthStateService.TTL).plusSeconds(1));

        assertThat(later.verify(issued.state(), issued.nonce())).isEmpty();
    }

    @Test
    void rejectsTamperedPayload() {
        var svc = service(SECRET, T0);
        var issued = svc.issue("https://ceitba.org.ar");
        var sig = issued.state().substring(issued.state().indexOf('.') + 1);
        var forgedPayload = issued.nonce() + "|" + (T0.getEpochSecond() + 600) + "|https://evil.com";
        var forged = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(forgedPayload.getBytes()) + "." + sig;

        assertThat(svc.verify(forged, issued.nonce())).isEmpty();
    }

    @Test
    void rejectsStateSignedWithAnotherKey() {
        var otherSecret = Base64.getEncoder().encodeToString(new byte[32]);
        var issued = service(otherSecret, T0).issue("https://ceitba.org.ar");

        assertThat(service(SECRET, T0).verify(issued.state(), issued.nonce())).isEmpty();
    }

    @Test
    void rejectsGarbage() {
        var svc = service(SECRET, T0);
        assertThat(svc.verify(null, "n")).isEmpty();
        assertThat(svc.verify("", "n")).isEmpty();
        assertThat(svc.verify("no-dot", "n")).isEmpty();
        assertThat(svc.verify("!!!.???", "n")).isEmpty();
        // Legacy format: plain base64url target, no signature.
        var legacy = Base64.getUrlEncoder().withoutPadding().encodeToString("https://evil.com".getBytes());
        assertThat(svc.verify(legacy, "n")).isEmpty();
    }
}
