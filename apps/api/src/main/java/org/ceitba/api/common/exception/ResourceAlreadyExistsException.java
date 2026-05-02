package org.ceitba.api.common.exception;

public class ResourceAlreadyExistsException extends DomainException {

    public ResourceAlreadyExistsException(String resource, String identifier) {
        super("%s with identifier '%s' already exists".formatted(resource, identifier));
    }
}
