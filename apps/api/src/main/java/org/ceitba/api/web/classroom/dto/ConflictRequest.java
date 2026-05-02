package org.ceitba.api.web.classroom.dto;

import jakarta.validation.constraints.NotBlank;

public record ConflictRequest(
    @NotBlank String classroom,
    @NotBlank String building,
    @NotBlank String day,
    @NotBlank String hourFrom,
    @NotBlank String hourTo
) {}
