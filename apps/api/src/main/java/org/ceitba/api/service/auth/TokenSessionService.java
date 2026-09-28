package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.web.auth.dto.TokenResponse;
import org.springframework.stereotype.Service;

import java.util.UUID;

// Token-based sessions for native clients (the Flutter app). Unlike the web
// flow, tokens travel in the response body, never in a cookie:
//   access  = our HS256 JWT, auth.jwt.mobile-access-ttl (default 15 min)
//   refresh = opaque rotating token, auth.jwt.refresh-ttl (default 60 days)
@Service
public class TokenSessionService {

    private final GoogleIdTokenVerifier googleVerifier;
    private final GoogleLoginService googleLogin;
    private final RefreshTokenService refreshTokens;
    private final JwtIssuerService jwtIssuer;
    private final UserMeService userMe;
    private final ReviewLoginService reviewLogin;

    public TokenSessionService(GoogleIdTokenVerifier googleVerifier,
                               GoogleLoginService googleLogin,
                               RefreshTokenService refreshTokens,
                               JwtIssuerService jwtIssuer,
                               UserMeService userMe,
                               ReviewLoginService reviewLogin) {
        this.googleVerifier = googleVerifier;
        this.googleLogin    = googleLogin;
        this.refreshTokens  = refreshTokens;
        this.jwtIssuer      = jwtIssuer;
        this.userMe         = userMe;
        this.reviewLogin    = reviewLogin;
    }

    // Verifies the Google ID token, applies the same gate as the web callback
    // (GoogleLoginService) and starts a new refresh-token family.
    public TokenResponse loginWithGoogle(String idToken, String nonce, String deviceName) {
        var claims  = googleVerifier.verify(idToken, nonce);
        var user    = googleLogin.admit(claims);
        var refresh = refreshTokens.issueNewFamily(user.getId(), deviceName);
        return respond(user, refresh);
    }

    // App Store / Play review account: email + password instead of Google,
    // then exactly the same token pair and refresh-token family as above.
    public TokenResponse loginWithReviewCredentials(String email, String password, String deviceName) {
        var user    = reviewLogin.authenticate(email, password);
        var refresh = refreshTokens.issueNewFamily(user.getId(), deviceName);
        return respond(user, refresh);
    }

    public TokenResponse refresh(String refreshToken) {
        var rotation = refreshTokens.rotate(refreshToken);
        return respond(rotation.user(), rotation.refreshToken());
    }

    public void logout(String refreshToken) {
        if (refreshToken != null && !refreshToken.isBlank()) {
            refreshTokens.revokeFamilyOf(refreshToken);
        }
    }

    public void logoutAll(UUID userId) {
        refreshTokens.revokeAllForUser(userId);
    }

    private TokenResponse respond(User user, RefreshTokenService.IssuedRefreshToken refresh) {
        var access = jwtIssuer.issueMobileAccess(user);
        return new TokenResponse(
            access.token(), access.expiresAt(),
            refresh.token(), refresh.expiresAt(),
            userMe.describe(user));
    }
}
