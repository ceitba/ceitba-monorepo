package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record VoteRequest(
    @NotBlank
    @Pattern(regexp = "up|down", message = "type must be 'up' or 'down'")
    String type
) {}
