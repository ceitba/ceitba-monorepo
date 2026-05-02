package org.ceitba.api.common.exception;

public class ExternalApiException extends DomainException {

    public ExternalApiException(String service, String operation, Throwable cause) {
        super("External API error in %s during %s".formatted(service, operation), cause);
    }
}
