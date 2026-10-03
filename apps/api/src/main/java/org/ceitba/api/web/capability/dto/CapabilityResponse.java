package org.ceitba.api.web.capability.dto;

public record CapabilityResponse(
    String key,
    String label,
    String description,
    boolean enabledForAll,
    long userGrantCount,
    long orgGrantCount
) {}
