package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// A credential presented to a token endpoint is unusable: a Google ID token
// that fails signature/iss/aud/exp/nonce checks, or a refresh token that is
// unknown, expired, revoked or reused. Mapped to 401 with error=invalid_token.
// The message is deliberately generic so it does not tell a caller which check
// failed.
public class InvalidTokenException extends DomainException {

    public InvalidTokenException(String message) {
        super(message);
    }

    public InvalidTokenException(String message, Throwable cause) {
        super(message, cause);
    }
}
