package org.ceitba.api.web.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.GoogleIdTokenVerifier;
import org.ceitba.api.service.auth.JwksGoogleIdTokenVerifier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.function.Consumer;

// Mints "Google" ID tokens signed with a local RSA key, and provides the real
// JwksGoogleIdTokenVerifier wired to that key instead of Google's JWKS, so ITs
// exercise the actual iss/aud/exp/nonce validation without the network.
final class TestGoogleIdTokens {

    static final String WEB_CLIENT = "test-web-client.apps.googleusercontent.com";
    static final String IOS_CLIENT = "test-ios-client.apps.googleusercontent.com";

    private static final KeyPair KEYS = generate();

    private TestGoogleIdTokens() {}

    static String token(String email, Consumer<JWTClaimsSet.Builder> customize) {
        var now = Instant.now();
        var claims = new JWTClaimsSet.Builder()
            .issuer("https://accounts.google.com")
            .audience(WEB_CLIENT)
            .subject("google-" + email)
            .claim("email", email)
            .claim("email_verified", true)
            .claim("name", "Test " + email)
            .claim("picture", "https://example.com/" + email + ".png")
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plusSeconds(3600)));
        customize.accept(claims);
        try {
            var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims.build());
            jwt.sign(new RSASSASigner((RSAPrivateKey) KEYS.getPrivate()));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    static String token(String email) {
        return token(email, b -> {});
    }

    @TestConfiguration
    static class LocalKeyVerifier {
        @Bean
        @Primary
        GoogleIdTokenVerifier localKeyGoogleVerifier(AuthProperties auth) {
            return new JwksGoogleIdTokenVerifier(auth,
                NimbusJwtDecoder.withPublicKey((RSAPublicKey) KEYS.getPublic()).build());
        }
    }

    private static KeyPair generate() {
        try {
            var g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            return g.generateKeyPair();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
