package org.ceitba.api.service.auth;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jose.util.ResourceRetriever;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.GoogleOAuthService.IdTokenClaims;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Service;

import java.net.MalformedURLException;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Set;

// Google ID-token verification with Spring Security's NimbusJwtDecoder
// (already on the classpath via the resource-server starter). This is a
// separate decoder: it must never replace the HS256 JwtDecoder bean that
// validates our own tokens.
//
// JWKS fetching (Nimbus JWKSourceBuilder): 3 s connect / 5 s read timeouts so
// a slow Google endpoint cannot pin request threads; keys cached for 5 min;
// and refetches rate-limited (at most 2 per 30 s) so tokens carrying random,
// unknown `kid`s cannot turn every login attempt into an outbound request.
//
// Checks: RS256 signature against Google's JWKS, iss ∈ {accounts.google.com, https://accounts.google.com},
// aud ∩ auth.google.mobile-audiences ≠ ∅, exp/nbf with 60 s skew, and the
// nonce when the client supplied one.
@Service
public class JwksGoogleIdTokenVerifier implements GoogleIdTokenVerifier {

    static final String GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
    static final Set<String> GOOGLE_ISSUERS = Set.of("accounts.google.com", "https://accounts.google.com");
    static final int CONNECT_TIMEOUT_MS = 3_000;
    static final int READ_TIMEOUT_MS = 5_000;
    static final int SIZE_LIMIT_BYTES = 64 * 1024;
    static final Duration CACHE_TTL = Duration.ofMinutes(5);
    static final Duration CACHE_REFRESH_TIMEOUT = Duration.ofSeconds(15);
    static final Duration MIN_REFETCH_INTERVAL = Duration.ofSeconds(30);

    private final NimbusJwtDecoder decoder;
    private final List<String> audiences;

    @Autowired
    public JwksGoogleIdTokenVerifier(AuthProperties auth) {
        this(auth, decoder(googleJwkSource(googleRetriever())));
    }

    // Tests pass a decoder backed by a local RSA key.
    public JwksGoogleIdTokenVerifier(AuthProperties auth, NimbusJwtDecoder decoder) {
        this.audiences = auth.google() != null ? auth.google().mobileAudiences() : List.of();
        this.decoder = decoder;
        this.decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(Duration.ofSeconds(60)),
            // JwtTimestampValidator passes tokens without exp; require it.
            jwt -> jwt.getExpiresAt() != null
                ? OAuth2TokenValidatorResult.success()
                : failure("The exp claim is required"),
            issuerValidator(),
            audienceValidator(audiences)));
    }

    @Override
    public IdTokenClaims verify(String idToken, String expectedNonce) {
        if (audiences.isEmpty()) {
            throw new FeatureNotConfiguredException(
                "Mobile Google login is not configured (AUTH_GOOGLE_MOBILE_AUDIENCES is empty)");
        }
        Jwt jwt;
        try {
            jwt = decoder.decode(idToken);
        } catch (JwtException e) {
            throw new InvalidTokenException("Google ID token is invalid", e);
        }
        if (expectedNonce != null && !expectedNonce.equals(jwt.getClaimAsString("nonce"))) {
            throw new InvalidTokenException("Google ID token is invalid");
        }
        String email = jwt.getClaimAsString("email");
        if (email == null || email.isBlank() || jwt.getSubject() == null) {
            throw new InvalidTokenException("Google ID token is invalid");
        }
        return new IdTokenClaims(
            jwt.getSubject(),
            email,
            jwt.getClaimAsString("name"),
            jwt.getClaimAsString("picture"),
            Boolean.TRUE.equals(jwt.getClaimAsBoolean("email_verified")),
            jwt.getClaimAsString("hd")
        );
    }

    static DefaultResourceRetriever googleRetriever() {
        return new DefaultResourceRetriever(CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS, SIZE_LIMIT_BYTES);
    }

    static JWKSource<SecurityContext> googleJwkSource(ResourceRetriever retriever) {
        try {
            return JWKSourceBuilder.<SecurityContext>create(URI.create(GOOGLE_JWKS).toURL(), retriever)
                .cache(CACHE_TTL.toMillis(), CACHE_REFRESH_TIMEOUT.toMillis())
                .rateLimited(MIN_REFETCH_INTERVAL.toMillis())
                .refreshAheadCache(false)
                .retrying(false)
                .outageTolerant(false)
                .build();
        } catch (MalformedURLException e) {
            throw new IllegalStateException(e);
        }
    }

    // Same processor NimbusJwtDecoder.withJwkSetUri builds (RS256 only, claim
    // checks left to the Spring validators set in the constructor), but over
    // our rate-limited JWK source.
    static NimbusJwtDecoder decoder(JWKSource<SecurityContext> jwkSource) {
        var processor = new DefaultJWTProcessor<SecurityContext>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource));
        processor.setJWTClaimsSetVerifier((claims, context) -> { });
        return new NimbusJwtDecoder(processor);
    }

    private static OAuth2TokenValidator<Jwt> issuerValidator() {
        return jwt -> GOOGLE_ISSUERS.contains(jwt.getClaimAsString(JwtClaimNames.ISS))
            ? OAuth2TokenValidatorResult.success()
            : failure("The iss claim is not valid");
    }

    private static OAuth2TokenValidator<Jwt> audienceValidator(List<String> audiences) {
        return jwt -> {
            var aud = jwt.getAudience();
            return aud != null && aud.stream().anyMatch(audiences::contains)
                ? OAuth2TokenValidatorResult.success()
                : failure("The aud claim is not valid");
        };
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(
            new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, description, null));
    }
}
