package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.GoogleOAuthService;
import org.ceitba.api.service.auth.JwtIssuerService;
import org.ceitba.api.service.auth.UserProvisioningService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Base64;
import java.util.List;

@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    private static final List<String> SAFE_REDIRECT_ORIGINS = List.of(
        "https://ceitba.org.ar",
        "http://localhost:3000",
        "http://localhost:3001"
    );

    private final GoogleOAuthService googleOAuth;
    private final JwtIssuerService jwtIssuer;
    private final UserProvisioningService provisioning;
    private final AuthProperties auth;

    public AuthController(GoogleOAuthService googleOAuth,
                          JwtIssuerService jwtIssuer,
                          UserProvisioningService provisioning,
                          AuthProperties auth) {
        this.googleOAuth  = googleOAuth;
        this.jwtIssuer    = jwtIssuer;
        this.provisioning = provisioning;
        this.auth         = auth;
    }

    // Frontend button links here. redirect_uri is where we send the token
    // after a successful login; defaults to auth.frontend-url if omitted.
    //
    // Example: GET /api/v1/auth/google?redirect_uri=http://localhost:3000/auth/callback
    @GetMapping("/google")
    public ResponseEntity<Void> initiateGoogleLogin(
            @RequestParam(required = false, name = "redirect_uri") String redirectUri) {
        String target = isSafeRedirect(redirectUri) ? redirectUri : auth.frontendUrl();
        String state  = Base64.getUrlEncoder().withoutPadding()
                              .encodeToString(target.getBytes());
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(googleOAuth.buildAuthorizationUri(state))
            .build();
    }

    // Google redirects here after the user authenticates.
    // On success:  redirect to <frontend>?token=<jwt>
    // On failure:  redirect to <frontend>?error=<reason>
    @GetMapping("/callback")
    public ResponseEntity<Void> handleGoogleCallback(
            @RequestParam String code,
            @RequestParam(required = false) String state) {
        String redirectTo = decodeState(state);
        try {
            var claims = googleOAuth.exchangeCode(code);
            if (!auth.admits(claims.email())) {
                return redirect(redirectTo + "?error=unauthorized");
            }
            var user  = provisioning.findOrCreate(claims.email(), claims.name());
            var token = jwtIssuer.issue(user);
            return redirect(redirectTo + "?token=" + token);
        } catch (Exception e) {
            return redirect(redirectTo + "?error=auth_failed");
        }
    }

    private boolean isSafeRedirect(String uri) {
        if (uri == null || uri.isBlank()) return false;
        return SAFE_REDIRECT_ORIGINS.stream().anyMatch(uri::startsWith);
    }

    private String decodeState(String state) {
        if (state == null) return auth.frontendUrl();
        try {
            return new String(Base64.getUrlDecoder().decode(state));
        } catch (Exception e) {
            return auth.frontendUrl();
        }
    }

    private static ResponseEntity<Void> redirect(String uri) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(uri)).build();
    }
}
