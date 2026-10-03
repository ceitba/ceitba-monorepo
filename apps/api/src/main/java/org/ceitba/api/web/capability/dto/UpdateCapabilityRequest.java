package org.ceitba.api.web.capability.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateCapabilityRequest(@NotNull Boolean enabledForAll) {}
