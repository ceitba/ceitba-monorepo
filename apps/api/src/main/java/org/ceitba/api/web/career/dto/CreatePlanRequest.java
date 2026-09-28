package org.ceitba.api.web.career.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// Body of POST /v1/careers/{id}/plans. `id` is the plan code exactly as the
// ITBA gateway spells it (it is the `plan` query parameter of careerPlans).
// `name` defaults to it.
public record CreatePlanRequest(
    @NotBlank @Size(max = 25) String id,
    @Size(max = 255) String name
) {}
