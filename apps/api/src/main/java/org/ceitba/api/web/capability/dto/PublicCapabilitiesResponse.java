package org.ceitba.api.web.capability.dto;

import java.util.List;

// Capability keys enabled for every user, sorted.
public record PublicCapabilitiesResponse(List<String> enabledForAll) {}
