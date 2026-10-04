package org.ceitba.api.service.mail;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jwt.SignedJWT;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.config.MailOAuthProperties;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.Set;

// Google OAuth for the sender accounts: authorization URL, code exchange,
// refresh-token -> access-token, revoke. Same OAuth client as the login flow
// (auth.google.*), its own redirect URI (mail.oauth.redirect-uri). Tokens are
// never logged; error messages carry only Google's error code.
@Component
public class GoogleMailOAuthClient {

    static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
    static final String AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
    static final String REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
    public static final String SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";
    static final Set<String> ISSUERS = Set.of("accounts.google.com", "https://accounts.google.com");

    public record Tokens(String accessToken, String refreshToken, String idToken, String scope, long expiresIn) {}

    public record IdClaims(String email, boolean emailVerified, String hd) {}

    public static class GoogleOAuthException extends RuntimeException {
        public enum Kind { INVALID_GRANT, REJECTED, TRANSPORT }

        private final Kind kind;

        public GoogleOAuthException(Kind kind, String message, Throwable cause) {
            super(message, cause);
            this.kind = kind;
        }

        public Kind kind() { return kind; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record TokenResponse(@JsonProperty("access_token") String accessToken,
                                 @JsonProperty("refresh_token") String refreshToken,
                                 @JsonProperty("id_token") String idToken,
                                 @JsonProperty("scope") String scope,
                                 @JsonProperty("expires_in") Long expiresIn) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ErrorResponse(String error) {}

    private final AuthProperties auth;
    private final MailOAuthProperties props;
    private final RestClient http;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock;

    public GoogleMailOAuthClient(AuthProperties auth, MailOAuthProperties props, Clock clock) {
        this.auth = auth;
        this.props = props;
        this.clock = clock;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public boolean configured() {
        var g = auth.google();
        return g != null && notBlank(g.clientId()) && notBlank(g.clientSecret()) && !props.redirectUri().isBlank();
    }

    // access_type=offline + prompt=consent: Google always returns a refresh token.
    public URI authorizationUri(String state, String loginHint, String hostedDomain) {
        var b = UriComponentsBuilder.fromUriString(AUTH_ENDPOINT)
            .queryParam("response_type", "code")
            .queryParam("client_id", auth.google().clientId())
            .queryParam("redirect_uri", props.redirectUri())
            .queryParam("scope", SCOPE_SEND + " openid email")
            .queryParam("state", state)
            .queryParam("access_type", "offline")
            .queryParam("prompt", "consent")
            .queryParam("login_hint", loginHint);
        if (hostedDomain != null) b.queryParam("hd", hostedDomain);
        // encode(): '+' and ':' in the scope list must be percent-encoded.
        return b.encode().build().toUri();
    }

    public Tokens exchangeCode(String code) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "authorization_code");
        form.add("code", code);
        form.add("redirect_uri", props.redirectUri());
        return tokens(form);
    }

    // Throws GoogleOAuthException INVALID_GRANT when the refresh token was
    // revoked/expired, TRANSPORT on network and 5xx errors.
    public Tokens refresh(String refreshToken) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", refreshToken);
        return tokens(form);
    }

    // Best effort: failures are swallowed (the row is deleted anyway).
    public void revoke(String token) {
        try {
            var form = new LinkedMultiValueMap<String, String>();
            form.add("token", token);
            http.post().uri(REVOKE_ENDPOINT).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form).retrieve().toBodilessEntity();
        } catch (RuntimeException ignored) {
            // best effort
        }
    }

    // The id_token comes straight from Google's token endpoint over TLS (as in
    // the login flow), so its signature is not re-verified; its claims are:
    // iss, aud = our client id, exp, and a verified email.
    public IdClaims parseIdToken(String idToken) {
        try {
            var claims = SignedJWT.parse(idToken).getJWTClaimsSet();
            if (!ISSUERS.contains(claims.getIssuer())) throw new IllegalArgumentException("iss");
            if (claims.getAudience() == null || !claims.getAudience().contains(auth.google().clientId())) {
                throw new IllegalArgumentException("aud");
            }
            Date exp = claims.getExpirationTime();
            if (exp == null || exp.toInstant().isBefore(clock.instant())) throw new IllegalArgumentException("exp");
            String email = claims.getStringClaim("email");
            if (email == null || email.isBlank()) throw new IllegalArgumentException("email");
            return new IdClaims(email, Boolean.TRUE.equals(claims.getBooleanClaim("email_verified")),
                claims.getStringClaim("hd"));
        } catch (java.text.ParseException | IllegalArgumentException e) {
            throw new GoogleOAuthException(GoogleOAuthException.Kind.REJECTED, "Invalid Google id_token", e);
        }
    }

    private Tokens tokens(LinkedMultiValueMap<String, String> form) {
        form.add("client_id", auth.google().clientId());
        form.add("client_secret", auth.google().clientSecret());
        try {
            var r = http.post().uri(TOKEN_ENDPOINT).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form).retrieve().body(TokenResponse.class);
            if (r == null || r.accessToken() == null) {
                throw new GoogleOAuthException(GoogleOAuthException.Kind.TRANSPORT, "Empty token response", null);
            }
            return new Tokens(r.accessToken(), r.refreshToken(), r.idToken(), r.scope(),
                r.expiresIn() == null ? 3600 : r.expiresIn());
        } catch (RestClientResponseException e) {
            String code = errorCode(e.getResponseBodyAsString());
            if (e.getStatusCode().is5xxServerError()) {
                throw new GoogleOAuthException(GoogleOAuthException.Kind.TRANSPORT,
                    "Google token endpoint HTTP " + e.getStatusCode().value(), e);
            }
            var kind = "invalid_grant".equals(code) ? GoogleOAuthException.Kind.INVALID_GRANT
                : GoogleOAuthException.Kind.REJECTED;
            throw new GoogleOAuthException(kind, "Google token endpoint: " + code, e);
        } catch (RestClientException e) {
            throw new GoogleOAuthException(GoogleOAuthException.Kind.TRANSPORT,
                "Google token endpoint unreachable", e);
        }
    }

    private String errorCode(String body) {
        try {
            var e = mapper.readValue(body, ErrorResponse.class);
            return e.error() == null ? "unknown" : e.error();
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
}
