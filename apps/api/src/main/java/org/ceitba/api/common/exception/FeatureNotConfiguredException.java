package org.ceitba.api.common.exception;

// Thrown by endpoints whose backing infrastructure (e.g. cloud storage) is not
// configured in this deployment. Mapped to 501 Not Implemented.
public class FeatureNotConfiguredException extends DomainException {

    public FeatureNotConfiguredException(String message) {
        super(message);
    }
}
