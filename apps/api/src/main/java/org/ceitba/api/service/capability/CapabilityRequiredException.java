package org.ceitba.api.service.capability;

import org.ceitba.api.common.exception.DomainException;

// The caller lacks a capability. Mapped to 403 CAPABILITY_REQUIRED.
public class CapabilityRequiredException extends DomainException {

    private final Capability capability;

    public CapabilityRequiredException(Capability capability) {
        super("This feature requires the '" + capability.key() + "' capability");
        this.capability = capability;
    }

    public Capability capability() { return capability; }
}
