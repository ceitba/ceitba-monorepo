package org.ceitba.api.web.auth;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class IssuerAudienceValidatorTest {

    private static final String ISS = "https://ceitba.org.ar/api";
    private static final String AUD = "ceitba-api";

    private static Jwt jwt(Consumer<Jwt.Builder> claims) {
        var b = Jwt.withTokenValue("t")
            .header("alg", "HS256")
            .claim("email", "alice@itba.edu.ar")
            .issuedAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(60));
        claims.accept(b);
        return b.build();
    }

    private static final IssuerAudienceValidator PHASE_IN = new IssuerAudienceValidator(ISS, AUD, false);
    private static final IssuerAudienceValidator ENFORCED = new IssuerAudienceValidator(ISS, AUD, true);

    @Test
    void phaseIn_acceptsLegacyTokenWithoutIssOrAud() {
        assertThat(PHASE_IN.validate(jwt(b -> {})).hasErrors()).isFalse();
    }

    @Test
    void phaseIn_acceptsMatchingIssAndAud() {
        assertThat(PHASE_IN.validate(jwt(b -> b.issuer(ISS).audience(List.of(AUD)))).hasErrors()).isFalse();
    }

    @Test
    void phaseIn_rejectsWrongIssuerWhenPresent() {
        assertThat(PHASE_IN.validate(jwt(b -> b.issuer("https://evil.example"))).hasErrors()).isTrue();
    }

    @Test
    void phaseIn_rejectsWrongAudienceWhenPresent() {
        assertThat(PHASE_IN.validate(jwt(b -> b.audience(List.of("other-api")))).hasErrors()).isTrue();
    }

    @Test
    void enforced_rejectsLegacyTokenWithoutClaims() {
        assertThat(ENFORCED.validate(jwt(b -> {})).hasErrors()).isTrue();
        assertThat(ENFORCED.validate(jwt(b -> b.issuer(ISS))).hasErrors()).isTrue();
    }

    @Test
    void enforced_acceptsMatchingClaims() {
        assertThat(ENFORCED.validate(jwt(b -> b.issuer(ISS).audience(List.of(AUD, "x")))).hasErrors()).isFalse();
    }
}
