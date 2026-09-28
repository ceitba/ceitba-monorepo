package org.ceitba.api.web.auth;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;

// Validates `iss` and `aud` on our own HS256 JWTs.
//
// Phase-in: JWTs issued before B1 carry neither claim and live in 7-day web
// cookies. While `enforce` is false, each claim is checked only when present,
// so those cookies keep working; a token that does carry iss/aud must match.
// Once every pre-B1 token has expired (deploy date + auth.jwt.ttl-days), set
// AUTH_JWT_ENFORCE_ISS_AUD=true to require both claims on every token.
public class IssuerAudienceValidator implements OAuth2TokenValidator<Jwt> {

    private final String issuer;
    private final String audience;
    private final boolean enforce;

    public IssuerAudienceValidator(String issuer, String audience, boolean enforce) {
        this.issuer = issuer;
        this.audience = audience;
        this.enforce = enforce;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        boolean hasIss = jwt.hasClaim(JwtClaimNames.ISS);
        if ((enforce || hasIss) && !issuer.equals(jwt.getClaimAsString(JwtClaimNames.ISS))) {
            return failure("The iss claim is not valid");
        }
        boolean hasAud = jwt.hasClaim(JwtClaimNames.AUD);
        var aud = jwt.getAudience();
        if ((enforce || hasAud) && (aud == null || !aud.contains(audience))) {
            return failure("The aud claim is not valid");
        }
        return OAuth2TokenValidatorResult.success();
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(
            new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, description, null));
    }
}
