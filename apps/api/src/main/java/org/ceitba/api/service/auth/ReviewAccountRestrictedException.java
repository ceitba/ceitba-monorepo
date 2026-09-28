package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// An operation the App Store / Play review account may not perform (e.g.
// minting an API key, which would outlive disabling review login). Mapped to
// 403 AccessDenied.
public class ReviewAccountRestrictedException extends DomainException {

    public ReviewAccountRestrictedException(String message) {
        super(message);
    }
}
