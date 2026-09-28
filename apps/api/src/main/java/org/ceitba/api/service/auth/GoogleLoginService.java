package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.auth.GoogleOAuthService.IdTokenClaims;
import org.springframework.stereotype.Service;

// The post-Google-login gate shared by every sign-in path (web OAuth callback
// and the mobile ID-token exchange), so the two can never drift apart.
//
// Defense in depth: verified flag + email allowlist + hosted-domain claim must
// all line up. `hd` is null for personal Gmail accounts and a Workspace domain
// otherwise; we accept it only when it matches one of the allowlisted domains.
// On success the User row is found or JIT-created (which also auto-follows the
// ceitba organization for brand-new users, see UserProvisioningService).
@Service
public class GoogleLoginService {

    private final AuthProperties auth;
    private final UserProvisioningService provisioning;

    public GoogleLoginService(AuthProperties auth, UserProvisioningService provisioning) {
        this.auth = auth;
        this.provisioning = provisioning;
    }

    public User admit(IdTokenClaims claims) {
        if (!claims.emailVerified()) {
            throw new LoginRejectedException(LoginRejectedException.Reason.UNVERIFIED_EMAIL);
        }
        if (!auth.admits(claims.email())) {
            throw new LoginRejectedException(LoginRejectedException.Reason.NOT_ALLOWLISTED);
        }
        if (claims.hd() != null && !auth.admits("anyone@" + claims.hd())) {
            throw new LoginRejectedException(LoginRejectedException.Reason.WORKSPACE_NOT_ALLOWED);
        }
        return provisioning.findOrCreate(claims.email(), claims.name(), claims.sub(), claims.picture());
    }
}
