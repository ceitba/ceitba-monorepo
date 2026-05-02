package org.ceitba.api.web.career.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateCareerRequest(
    @NotBlank @Size(max = 25) String id,
    @NotBlank @Size(max = 255) String name
) {}
