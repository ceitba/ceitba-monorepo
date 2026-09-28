package org.ceitba.api.service.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.util.Resource;
import com.nimbusds.jose.util.ResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.Test;

import java.net.URL;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwksGoogleIdTokenVerifierTest {

    private static AuthProperties props(List<String> audiences) {
        return new AuthProperties(null, null, null,
            new AuthProperties.Google("web", "secret", "http://x/cb", audiences),
            null, null, null);
    }

    @Test
    void emptyAudiencesDisableMobileLogin() {
        var verifier = new JwksGoogleIdTokenVerifier(props(List.of()));
        assertThatThrownBy(() -> verifier.verify("anything", null))
            .isInstanceOf(FeatureNotConfiguredException.class);
    }

    @Test
    void blankAudienceEntriesAreIgnored() {
        assertThat(props(java.util.Arrays.asList(" a ", "", null)).google().mobileAudiences())
            .containsExactly("a");
    }

    @Test
    void garbageTokenIsInvalid() {
        var verifier = new JwksGoogleIdTokenVerifier(props(List.of("aud")));
        assertThatThrownBy(() -> verifier.verify("not-a-jwt", null))
            .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void jwksFetchesHaveConnectAndReadTimeouts() {
        var retriever = JwksGoogleIdTokenVerifier.googleRetriever();
        assertThat(retriever.getConnectTimeout()).isEqualTo(3_000);
        assertThat(retriever.getReadTimeout()).isEqualTo(5_000);
        assertThat(retriever.getSizeLimit()).isPositive();
    }

    // Tokens with unknown `kid`s must not each trigger a JWKS download.
    @Test
    void unknownKeyIdsDoNotRefetchTheJwksOnEveryRequest() throws Exception {
        var keys = rsa();
        var fetches = new AtomicInteger();
        String jwks = new JWKSet(new RSAKey.Builder((RSAPublicKey) keys.getPublic()).keyID("known").build())
            .toString();
        ResourceRetriever retriever = (URL url) -> {
            fetches.incrementAndGet();
            return new Resource(jwks, "application/json");
        };
        var verifier = new JwksGoogleIdTokenVerifier(props(List.of("aud")),
            JwksGoogleIdTokenVerifier.decoder(JwksGoogleIdTokenVerifier.googleJwkSource(retriever)));

        assertThat(verifier.verify(sign(keys, "known"), null).email()).isEqualTo("a@itba.edu.ar");
        for (int i = 0; i < 10; i++) {
            String token = sign(keys, "unknown-" + i);
            assertThatThrownBy(() -> verifier.verify(token, null)).isInstanceOf(InvalidTokenException.class);
        }

        // One initial fetch plus at most one rate-limited refresh (a plain
        // RemoteJWKSet would have fetched once per unknown kid: 11 times).
        assertThat(fetches.get()).isLessThanOrEqualTo(2);
        // Known keys keep verifying from the cache.
        assertThat(verifier.verify(sign(keys, "known"), null).email()).isEqualTo("a@itba.edu.ar");
    }

    private static KeyPair rsa() throws Exception {
        var g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        return g.generateKeyPair();
    }

    private static String sign(KeyPair keys, String kid) throws JOSEException {
        var now = Instant.now();
        var claims = new JWTClaimsSet.Builder()
            .issuer("https://accounts.google.com")
            .audience("aud")
            .subject("sub-1")
            .claim("email", "a@itba.edu.ar")
            .claim("email_verified", true)
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plusSeconds(600)))
            .build();
        var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(), claims);
        jwt.sign(new RSASSASigner((RSAPrivateKey) keys.getPrivate()));
        return jwt.serialize();
    }
}
