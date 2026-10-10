package org.ceitba.api.service.auth;

import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

// The user API key the current request authenticated with, if any. ApiKeyFilter
// puts the ValidatedKey in the authentication's details; JWT sessions, the sync
// key and background jobs have none, so nothing here narrows them.
//
// Services that grant staff powers from the database (an active ceitba_staff or
// moderator row) must also check staffWithheld(): a key without the "staff"
// scope must not reach them, whatever its owner holds.
public final class ApiKeyCredential {

    private ApiKeyCredential() {}

    public static Optional<ApiKeyService.ValidatedKey> current() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getDetails() instanceof ApiKeyService.ValidatedKey k
            ? Optional.of(k) : Optional.empty();
    }

    // True when the caller uses an API key that lacks the "staff" scope.
    public static boolean staffWithheld() {
        return current().map(k -> !k.has(ApiKeyScope.STAFF)).orElse(false);
    }
}
