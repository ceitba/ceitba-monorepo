package org.ceitba.api.common.exception;

// Base for every application-thrown exception. Concrete subclasses live next
// to the feature that throws them; truly cross-cutting ones live alongside
// this base. The GlobalExceptionHandler decides the HTTP status; controllers
// and services do NOT.
public abstract class DomainException extends RuntimeException {

    protected DomainException(String message) {
        super(message);
    }

    protected DomainException(String message, Throwable cause) {
        super(message, cause);
    }
}
