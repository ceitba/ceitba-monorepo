package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateSourceRequest(@NotNull Boolean anonymous) {}
