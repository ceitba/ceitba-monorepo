package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// Wrong email or password on POST /v1/auth/review-login. Mapped to 401 with
// error=invalid_credentials; the message never says which part was wrong.
public class InvalidCredentialsException extends DomainException {

    public InvalidCredentialsException() {
        super("Invalid email or password");
    }
}
