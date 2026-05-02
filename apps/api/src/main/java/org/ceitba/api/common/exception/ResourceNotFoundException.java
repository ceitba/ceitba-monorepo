package org.ceitba.api.common.exception;

public class ResourceNotFoundException extends DomainException {

    public ResourceNotFoundException(String resource, String identifier) {
        super("%s with identifier '%s' not found".formatted(resource, identifier));
    }
}
