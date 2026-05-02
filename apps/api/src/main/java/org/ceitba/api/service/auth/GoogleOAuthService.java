package org.ceitba.api.service.auth;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.config.AuthProperties;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

// Handles the server-side Google OAuth 2.0 authorization-code flow.
// The frontend just needs a link to /v1/auth/google; all redirects and
// token exchange happen here.
@Service
public class GoogleOAuthService {

    private static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
    private static final String AUTH_ENDPOINT  = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String SCOPE          = "openid email profile";

    private final AuthProperties auth;
    private final RestClient http;

    public GoogleOAuthService(AuthProperties auth) {
        this.auth = auth;
        this.http = RestClient.create();
    }

    public URI buildAuthorizationUri(String state) {
        var g = auth.google();
        return UriComponentsBuilder.fromUriString(AUTH_ENDPOINT)
            .queryParam("response_type", "code")
            .queryParam("client_id", g.clientId())
            .queryParam("redirect_uri", g.redirectUri())
            .queryParam("scope", SCOPE)
            .queryParam("state", state)
            .queryParam("access_type", "offline")
            .build().toUri();
    }

    // Exchanges the authorization code for tokens and parses the id_token claims.
    // The id_token is decoded (not re-verified) because it was obtained directly
    // from Google's HTTPS token endpoint, so there is no MITM risk.
    public IdTokenClaims exchangeCode(String code) {
        var g = auth.google();
        String body = "grant_type=authorization_code"
            + "&code=" + enc(code)
            + "&redirect_uri=" + enc(g.redirectUri())
            + "&client_id=" + enc(g.clientId())
            + "&client_secret=" + enc(g.clientSecret());

        var resp = http.post()
            .uri(TOKEN_ENDPOINT)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(body)
            .retrieve()
            .body(TokenResponse.class);

        try {
            var jwt    = SignedJWT.parse(resp.idToken());
            var claims = jwt.getJWTClaimsSet();
            return new IdTokenClaims(
                claims.getStringClaim("email"),
                claims.getStringClaim("name"),
                Boolean.TRUE.equals(claims.getBooleanClaim("email_verified"))
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Google id_token", e);
        }
    }

    private static String enc(String v) {
        return v == null ? "" : URLEncoder.encode(v, StandardCharsets.UTF_8);
    }

    public record IdTokenClaims(String email, String name, boolean emailVerified) {}

    private record TokenResponse(
        @JsonProperty("access_token") String accessToken,
        @JsonProperty("id_token")     String idToken,
        @JsonProperty("token_type")   String tokenType,
        @JsonProperty("expires_in")   int    expiresIn
    ) {}
}
