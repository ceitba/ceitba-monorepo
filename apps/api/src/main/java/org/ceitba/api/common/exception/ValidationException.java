package org.ceitba.api.common.exception;

public class ValidationException extends DomainException {

    public ValidationException(String field, Object value, String reason) {
        super("Validation failed for field '%s' with value '%s': %s".formatted(field, value, reason));
    }
}
