package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// POST /v1/auth/review-login while review login is not configured. Mapped to
// a plain 404 so the endpoint does not advertise itself.
public class ReviewLoginDisabledException extends DomainException {

    public ReviewLoginDisabledException() {
        super("Not found");
    }
}
