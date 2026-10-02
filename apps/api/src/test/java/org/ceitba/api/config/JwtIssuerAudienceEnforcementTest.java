package org.ceitba.api.config;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtValidationException;

import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// iss/aud are mandatory by default since the B1 phase-in ended (2026-10-05):
// the decoder SecurityConfig builds must reject a token without them unless
// AUTH_JWT_ENFORCE_ISS_AUD=false is set explicitly.
class JwtIssuerAudienceEnforcementTest {

    private static final String SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    private static final String ISS = "https://ceitba.org.ar/api";

    private static AuthProperties auth(Boolean enforce) {
        return new AuthProperties(List.of(), List.of(), null, null,
            new AuthProperties.Jwt(SECRET, 7, ISS, enforce, null, null, null), null, null);
    }

    private static String token(Consumer<JWTClaimsSet.Builder> extra) throws Exception {
        var claims = new JWTClaimsSet.Builder()
            .subject("user-1")
            .claim("email", "alice@itba.edu.ar")
            .issueTime(new Date())
            .expirationTime(Date.from(Instant.now().plusSeconds(300)));
        extra.accept(claims);
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims.build());
        jwt.sign(new MACSigner(Base64.getDecoder().decode(SECRET)));
        return jwt.serialize();
    }

    private static String legacyToken() throws Exception {
        return token(c -> {});
    }

    private static String currentToken() throws Exception {
        return token(c -> c.issuer(ISS).audience(AuthProperties.Jwt.AUDIENCE));
    }

    @Test
    void enforcementIsOnWhenUnset() {
        assertThat(auth(null).jwt().enforceIssuerAudience()).isTrue();
        assertThat(auth(true).jwt().enforceIssuerAudience()).isTrue();
        assertThat(auth(false).jwt().enforceIssuerAudience()).isFalse();
    }

    @Test
    void defaultDecoderRejectsTokensWithoutIssAndAud() throws Exception {
        var decoder = new SecurityConfig().jwtDecoder(auth(null));

        assertThatThrownBy(() -> decoder.decode(legacyToken()))
            .isInstanceOf(JwtValidationException.class);
        assertThatThrownBy(() -> decoder.decode(token(c -> c.issuer(ISS))))
            .isInstanceOf(JwtValidationException.class)
            .hasMessageContaining("aud");
        assertThat(decoder.decode(currentToken()).getSubject()).isEqualTo("user-1");
    }

    @Test
    void explicitPhaseInStillAcceptsLegacyTokens() throws Exception {
        var decoder = new SecurityConfig().jwtDecoder(auth(false));

        assertThat(decoder.decode(legacyToken()).getSubject()).isEqualTo("user-1");
        assertThatThrownBy(() -> decoder.decode(token(c -> c.issuer("https://evil.example"))))
            .isInstanceOf(JwtValidationException.class);
    }
}
