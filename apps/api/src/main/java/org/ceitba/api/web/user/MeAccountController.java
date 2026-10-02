package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.user.AccountDeletionService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.auth.SessionCookies;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// DELETE /v1/me — the caller deletes their own account (USER). See
// AccountDeletionService for what is deleted vs anonymized. Also clears the
// web session cookie; the mobile app should drop its stored tokens on 204.
//
// Only a signed-in session (our JWT, web cookie or mobile bearer) may delete
// the account: a per-user ceitba_ API key gets 403, so a leaked script key
// cannot irreversibly wipe its owner's account.
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me")
public class MeAccountController {

    private final AccountDeletionService accountDeletion;
    private final AuthProperties auth;

    public MeAccountController(AccountDeletionService accountDeletion, AuthProperties auth) {
        this.accountDeletion = accountDeletion;
        this.auth = auth;
    }

    @DeleteMapping
    @PreAuthorize("authentication instanceof T(org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken)")
    @Operation(summary = "Delete the current user's account and personal data; revokes all refresh tokens and API keys. "
        + "Requires a JWT session (API keys get 403); 409 if the caller is the only active staff member")
    public ResponseEntity<Void> deleteMe(@CurrentUser User user) {
        accountDeletion.deleteAccount(user.getId());
        return ResponseEntity.noContent()
            .headers(h -> h.addAll(HttpHeaders.SET_COOKIE, SessionCookies.clearHeaders(auth)))
            .build();
    }
}
