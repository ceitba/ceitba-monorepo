package org.ceitba.api.service.auth;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.springframework.stereotype.Service;
import org.springframework.util.Assert;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

// Issues HMAC-SHA256 JWTs consumed by every authenticated endpoint.
// Replaces the previous model of forwarding Google id_tokens as Bearer tokens,
// which expired after 1 hour with no way to refresh server-side.
//
// Claims: sub (user id), email, name, iat, exp, plus iss (auth.jwt.issuer),
// aud ("ceitba-api") and a random jti. SecurityConfig requires both iss and
// aud (see IssuerAudienceValidator).
//
// Required env: AUTH_JWT_SECRET=<base64-encoded 32+ byte secret>
// Generate with: openssl rand -base64 32
@Service
public class JwtIssuerService {

    private final SecretKey signingKey;
    private final Duration webTtl;
    private final Duration mobileTtl;
    private final String issuer;

    public JwtIssuerService(AuthProperties auth) {
        Assert.notNull(auth.jwt(), "auth.jwt must be configured");
        Assert.hasText(auth.jwt().secret(), "auth.jwt.secret (AUTH_JWT_SECRET) must not be empty");
        byte[] raw = Base64.getDecoder().decode(auth.jwt().secret());
        Assert.isTrue(raw.length >= 32, "AUTH_JWT_SECRET must decode to at least 32 bytes (256 bits)");
        this.signingKey = new SecretKeySpec(raw, "HmacSHA256");
        this.webTtl = Duration.ofDays(auth.jwt().ttlDays() > 0 ? auth.jwt().ttlDays() : 7);
        this.mobileTtl = auth.jwt().mobileAccessTtl();
        this.issuer = auth.jwt().issuer();
    }

    // Web session token (HttpOnly cookie), lifetime auth.jwt.ttl-days.
    public String issue(User user) {
        return issue(user, webTtl).token();
    }

    // Short-lived access token for the mobile token endpoints; the app renews
    // it with a refresh token.
    public IssuedToken issueMobileAccess(User user) {
        return issue(user, mobileTtl);
    }

    private IssuedToken issue(User user, Duration ttl) {
        try {
            var now = Instant.now();
            var exp = now.plus(ttl);
            var claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(AuthProperties.Jwt.AUDIENCE)
                .jwtID(UUID.randomUUID().toString())
                .subject(user.getId().toString())
                .claim("email", user.getEmail())
                .claim("name", user.getName())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(exp))
                .build();
            var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(signingKey));
            // JWT exp has second precision; report the same instant we signed.
            return new IssuedToken(jwt.serialize(), Instant.ofEpochSecond(exp.getEpochSecond()));
        } catch (com.nimbusds.jose.JOSEException e) {
            throw new RuntimeException("JWT signing failed", e);
        }
    }

    public record IssuedToken(String token, Instant expiresAt) {}
}
