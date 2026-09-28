package org.ceitba.api.web.auth;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.auth.TokenSessionService;
import org.ceitba.api.web.auth.dto.GoogleMobileLoginRequest;
import org.ceitba.api.web.auth.dto.RefreshRequest;
import org.ceitba.api.web.auth.dto.TokenResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Token endpoints for native clients. Public (permitAll) and rate-limited
// per IP like the rest of /v1/auth/**. Errors:
//   401 {error: "invalid_token"}                         bad/expired/reused token
//   403 {error: "unverified_email" | "unauthorized" | "unauthorized_workspace"}
//   501 mobile login not configured (no AUTH_GOOGLE_MOBILE_AUDIENCES)
@Tag(name = "Auth")
@RestController
@RequestMapping("/v1/auth")
public class TokenAuthController {

    private final TokenSessionService sessions;

    public TokenAuthController(TokenSessionService sessions) {
        this.sessions = sessions;
    }

    @PostMapping("/google/mobile")
    @Operation(summary = "Exchange a Google ID token from the mobile app for an access + refresh token pair")
    public ResponseEntity<TokenResponse> googleMobile(@Valid @RequestBody GoogleMobileLoginRequest req) {
        return noStore(sessions.loginWithGoogle(req.idToken(), req.nonce(), req.deviceName()));
    }

    @PostMapping("/refresh")
    @Operation(summary = "Rotate a refresh token; returns a new access + refresh token pair")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest req) {
        return noStore(sessions.refresh(req.refreshToken()));
    }

    private static ResponseEntity<TokenResponse> noStore(TokenResponse body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
