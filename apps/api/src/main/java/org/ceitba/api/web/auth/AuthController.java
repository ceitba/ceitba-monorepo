package org.ceitba.api.web.auth;

import jakarta.validation.Valid;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.service.auth.GoogleOAuthService;
import org.ceitba.api.service.auth.JwtIssuerService;
import org.ceitba.api.service.auth.UserProvisioningService;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.web.auth.dto.ApiKeyCreatedResponse;
import org.ceitba.api.web.auth.dto.ApiKeyResponse;
import org.ceitba.api.web.auth.dto.CreateApiKeyRequest;
import org.ceitba.api.web.auth.dto.UserMeResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    private static final List<String> SAFE_REDIRECT_ORIGINS = List.of(
        "https://ceitba.org.ar",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:5175"
    );

    private final GoogleOAuthService googleOAuth;
    private final JwtIssuerService jwtIssuer;
    private final UserProvisioningService provisioning;
    private final ApiKeyService apiKeyService;
    private final CeitbaStaffRepository staffRepository;
    private final OrganizationMembershipService memberships;
    private final FollowService follows;
    private final AuthProperties auth;

    public AuthController(GoogleOAuthService googleOAuth,
                          JwtIssuerService jwtIssuer,
                          UserProvisioningService provisioning,
                          ApiKeyService apiKeyService,
                          CeitbaStaffRepository staffRepository,
                          OrganizationMembershipService memberships,
                          FollowService follows,
                          AuthProperties auth) {
        this.googleOAuth      = googleOAuth;
        this.jwtIssuer        = jwtIssuer;
        this.provisioning     = provisioning;
        this.apiKeyService    = apiKeyService;
        this.staffRepository  = staffRepository;
        this.memberships      = memberships;
        this.follows          = follows;
        this.auth             = auth;
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
            var user  = provisioning.findOrCreate(claims.email(), claims.name(), claims.sub(), claims.picture());
            var token = jwtIssuer.issue(user);
            return redirect(redirectTo + "?token=" + token);
        } catch (Exception e) {
            return redirect(redirectTo + "?error=auth_failed");
        }
    }

    // Returns the authenticated user's profile. Role is "staff" when the user
    // has an active CeitbaStaff row, otherwise "user".
    @GetMapping("/me")
    public UserMeResponse me(@CurrentUser User user) {
        boolean isStaff = staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now());
        var orgs = memberships.listForUser(user.getId()).stream()
            .map(m -> new UserMeResponse.MembershipDto(m.getOrganization(), m.getRole()))
            .toList();
        var followSlugs = follows.listForUser(user.getId()).stream()
            .map(f -> f.getOrganization())
            .toList();
        return new UserMeResponse(
            user.getId(),
            user.getName(),
            user.getEmail(),
            isStaff ? "staff" : "user",
            user.getAvatarUrl(),
            orgs,
            followSlugs
        );
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
