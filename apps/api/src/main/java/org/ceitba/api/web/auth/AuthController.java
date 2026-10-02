package org.ceitba.api.web.auth;

import jakarta.validation.Valid;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.service.auth.GoogleLoginService;
import org.ceitba.api.service.auth.GoogleOAuthService;
import org.ceitba.api.service.auth.JwtIssuerService;
import org.ceitba.api.service.auth.LoginRejectedException;
import org.ceitba.api.service.auth.OAuthStateService;
import org.ceitba.api.service.auth.TokenSessionService;
import org.ceitba.api.service.auth.UserMeService;
import org.ceitba.api.web.auth.dto.ApiKeyCreatedResponse;
import org.ceitba.api.web.auth.dto.ApiKeyResponse;
import org.ceitba.api.web.auth.dto.CreateApiKeyRequest;
import org.ceitba.api.web.auth.dto.LogoutRequest;
import org.ceitba.api.web.auth.dto.UserMeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private static final List<String> SAFE_REDIRECT_ORIGINS = List.of(
        "https://ceitba.org.ar",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:5175"
    );

    // Short-lived HttpOnly cookie binding the OAuth `state` to the browser
    // that started the login (see OAuthStateService).
    static final String STATE_COOKIE = "ceitba_oauth_state";

    private final GoogleOAuthService googleOAuth;
    private final JwtIssuerService jwtIssuer;
    private final OAuthStateService oauthState;
    private final GoogleLoginService googleLogin;
    private final UserMeService userMe;
    private final ApiKeyService apiKeyService;
    private final TokenSessionService tokenSessions;
    private final AuthProperties auth;
    private final ObjectMapper objectMapper;

    public AuthController(GoogleOAuthService googleOAuth,
                          JwtIssuerService jwtIssuer,
                          OAuthStateService oauthState,
                          GoogleLoginService googleLogin,
                          UserMeService userMe,
                          ApiKeyService apiKeyService,
                          TokenSessionService tokenSessions,
                          AuthProperties auth,
                          ObjectMapper objectMapper) {
        this.googleOAuth      = googleOAuth;
        this.jwtIssuer        = jwtIssuer;
        this.oauthState       = oauthState;
        this.googleLogin      = googleLogin;
        this.userMe           = userMe;
        this.apiKeyService    = apiKeyService;
        this.tokenSessions    = tokenSessions;
        this.auth             = auth;
        this.objectMapper     = objectMapper;
    }

    // Frontend button links here. redirect_uri is where we send the browser
    // after a successful login; the JWT is delivered via HttpOnly cookie, not
    // via URL parameter, so the frontend just lands on a clean URL.
    //
    // Example: GET /api/v1/auth/google?redirect_uri=https://ceitba.org.ar/manage
    @GetMapping("/google")
    public ResponseEntity<Void> initiateGoogleLogin(
            @RequestParam(required = false, name = "redirect_uri") String redirectUri) {
        String target = isSafeRedirect(redirectUri) ? redirectUri : auth.frontendUrl();
        var issued = oauthState.issue(target);
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(googleOAuth.buildAuthorizationUri(issued.state()))
            .header(HttpHeaders.SET_COOKIE, stateCookie(issued.nonce(), OAuthStateService.TTL).toString())
            .build();
    }

    // Google redirects here after the user authenticates.
    // On success: set HttpOnly session cookie and redirect to the SPA URL.
    // On failure: redirect to <frontend>?error=<reason>
    // The state must be authentic, unexpired and match the nonce cookie set by
    // /google; otherwise we never exchange the code (login-CSRF protection).
    // When the user cancels the consent screen Google sends ?error=access_denied
    // and no code: that also lands on the SPA (error=access_denied), never on a
    // raw 400 from the API.
    @GetMapping("/callback")
    public ResponseEntity<Void> handleGoogleCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error,
            @CookieValue(name = STATE_COOKIE, required = false) String stateNonce) {
        // Re-check the target even though it is signed: FRONTEND_URL (the
        // fallback) or an allowed origin are the only valid destinations.
        var verified = oauthState.verify(state, stateNonce)
            .filter(t -> t.equals(auth.frontendUrl()) || isSafeRedirect(t));
        if (verified.isEmpty()) {
            return redirect(withError(auth.frontendUrl(), "invalid_state"));
        }
        String redirectTo = verified.get();
        if (error != null || code == null || code.isBlank()) {
            // Only map to codes the SPAs know; never echo Google's value back.
            String reason = "access_denied".equals(error) ? "access_denied" : "auth_failed";
            return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(withError(redirectTo, reason)))
                .header(HttpHeaders.SET_COOKIE, stateCookie("", Duration.ZERO).toString())
                .build();
        }
        try {
            var claims = googleOAuth.exchangeCode(code);
            // email_verified / allowlist / hd checks + find-or-create live in
            // GoogleLoginService, shared with the mobile ID-token exchange.
            var user  = googleLogin.admit(claims);
            var token = jwtIssuer.issue(user);
            return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(redirectTo))
                .header(HttpHeaders.SET_COOKIE, SessionCookies.issue(auth, token).toString())
                .header(HttpHeaders.SET_COOKIE, stateCookie("", Duration.ZERO).toString())
                .build();
        } catch (LoginRejectedException e) {
            return redirect(withError(redirectTo, e.reason().code()));
        } catch (Exception e) {
            // Class + message only: never the code, tokens or claims.
            log.warn("Google OAuth callback failed: {}: {}", e.getClass().getSimpleName(), e.getMessage());
            return redirect(withError(redirectTo, "auth_failed"));
        }
    }

    // Clears the session cookie and, when a JSON body carries a refreshToken,
    // revokes that token's whole family (mobile logout). 204 whatever the
    // Content-Type — does not require an active session, so a stale-cookie
    // client can call this safely. The body is read as a raw string and only
    // parsed when it is JSON, so a web client posting text/plain
    // (navigator.sendBeacon), a form, or no body at all gets 204 instead of
    // 415. (Two consumes-split mappings are ambiguous for body-less POSTs.)
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType,
            @RequestBody(required = false) String rawBody) {
        LogoutRequest body = parseLogoutBody(contentType, rawBody);
        if (body != null && body.refreshToken() != null) tokenSessions.logout(body.refreshToken());
        return ResponseEntity.noContent()
            .headers(h -> h.addAll(HttpHeaders.SET_COOKIE, SessionCookies.clearHeaders(auth)))
            .build();
    }

    private LogoutRequest parseLogoutBody(String contentType, String rawBody) {
        if (rawBody == null || rawBody.isBlank() || contentType == null) return null;
        MediaType type;
        try {
            type = MediaType.parseMediaType(contentType);
        } catch (InvalidMediaTypeException e) {
            return null;
        }
        if (!MediaType.APPLICATION_JSON.isCompatibleWith(type)) return null;
        try {
            return objectMapper.readValue(rawBody, LogoutRequest.class);
        } catch (JsonProcessingException e) {
            throw new ValidationException("body", "<malformed>", "logout body must be valid JSON");
        }
    }

    // Revokes every refresh-token family of the caller (all devices) and clears
    // the web cookie. Already-issued access tokens stay valid until they
    // expire (mobile: auth.jwt.mobile-access-ttl).
    @PostMapping("/logout-all")
    public ResponseEntity<Void> logoutAll(@CurrentUser User user) {
        tokenSessions.logoutAll(user.getId());
        return ResponseEntity.noContent()
            .headers(h -> h.addAll(HttpHeaders.SET_COOKIE, SessionCookies.clearHeaders(auth)))
            .build();
    }

    // Returns the authenticated user's profile (see UserMeService).
    @GetMapping("/me")
    public UserMeResponse me(@CurrentUser User user) {
        return userMe.describe(user);
    }

    // -----------------------------------------------------------------------
    // User API Keys — require authentication (any allowlisted user or API key)
    // -----------------------------------------------------------------------

    // Creates a new API key. The raw key (ceitba_*) is returned ONCE; store it immediately.
    @PostMapping("/api-keys")
    public ResponseEntity<ApiKeyCreatedResponse> createApiKey(
            @RequestBody @Valid CreateApiKeyRequest req,
            @CurrentUser User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(apiKeyService.create(user, req.name(), req.ttlDays()));
    }

    // Lists all non-expired API keys for the authenticated user (keys are redacted).
    @GetMapping("/api-keys")
    public List<ApiKeyResponse> listApiKeys(@CurrentUser User user) {
        return apiKeyService.listActive(user);
    }

    // Revokes a key; returns 204 on success, 404 if not found / not owned by caller.
    @DeleteMapping("/api-keys/{id}")
    public ResponseEntity<Void> revokeApiKey(@PathVariable UUID id, @CurrentUser User user) {
        return apiKeyService.revoke(user, id)
            ? ResponseEntity.noContent().build()
            : ResponseEntity.notFound().build();
    }

    // -----------------------------------------------------------------------

    // Exact origin match (scheme + host + port) against SAFE_REDIRECT_ORIGINS.
    // A plain prefix check would accept e.g. https://ceitba.org.ar.evil.com or
    // https://ceitba.org.ar@evil.com.
    static boolean isSafeRedirect(String uri) {
        if (uri == null || uri.isBlank()) return false;
        URI u;
        try {
            u = new URI(uri);
        } catch (URISyntaxException e) {
            return false;
        }
        if (!u.isAbsolute() || u.isOpaque() || u.getRawUserInfo() != null
                || u.getScheme() == null || u.getHost() == null) {
            return false;
        }
        return SAFE_REDIRECT_ORIGINS.contains(origin(u));
    }

    private static String origin(URI u) {
        String scheme = u.getScheme().toLowerCase(Locale.ROOT);
        int port = u.getPort();
        if ((port == 443 && scheme.equals("https")) || (port == 80 && scheme.equals("http"))) port = -1;
        return scheme + "://" + u.getHost().toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port);
    }

    private static String withError(String target, String reason) {
        return UriComponentsBuilder.fromUriString(target)
            .replaceQueryParam("error", reason)
            .build()
            .toUriString();
    }

    private static ResponseEntity<Void> redirect(String uri) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(uri)).build();
    }

    // SameSite=Lax is required: Google's redirect back to /callback is a
    // cross-site top-level GET, which Lax (but not Strict) cookies survive.
    private ResponseCookie stateCookie(String value, Duration maxAge) {
        var cfg = auth.cookie();
        return ResponseCookie.from(STATE_COOKIE, value)
            .httpOnly(true)
            .secure(cfg.secure())
            .path(cfg.path())
            .sameSite("Lax")
            .maxAge(maxAge)
            .build();
    }
}
