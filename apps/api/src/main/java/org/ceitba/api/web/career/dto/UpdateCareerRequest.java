package org.ceitba.api.web.career.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// Only `name` is mutable. Career IDs are stable identifiers from the upstream
// ITBA backend; renaming an id would break every downstream FK.
public record UpdateCareerRequest(
    @NotBlank @Size(max = 255) String name
) {}
