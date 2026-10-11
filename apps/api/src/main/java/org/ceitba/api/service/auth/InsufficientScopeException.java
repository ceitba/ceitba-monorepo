package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// The caller's API key lacks a scope the operation needs. Mapped to
// 403 INSUFFICIENT_SCOPE, the same code ApiKeyFilter answers with.
public class InsufficientScopeException extends DomainException {

    public static final String CODE = "INSUFFICIENT_SCOPE";

    public InsufficientScopeException(String message) {
        super(message);
    }
}
